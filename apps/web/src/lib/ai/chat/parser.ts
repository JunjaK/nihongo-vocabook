/**
 * Stream parser for `<tool_call>...</tool_call>` segments inside a streaming
 * assistant response. Buffers across token boundaries so a tag split across
 * two chunks is still captured.
 *
 * Tolerances ported from the Phase 0 PoC v3 parser:
 *  - Multi-call: a single `<tool_call>` body containing N comma-separated
 *    objects yields N `tool_call` chunks.
 *  - Name-prefix: `tool_name{"...":...}` (name outside JSON) is recovered.
 *  - Auto-close: at flush, unbalanced `{` / `[` are closed so a truncated
 *    JSON tail can still parse.
 *  - Permissive close: at flush, an unterminated `<tool_call>` body is run
 *    through the same recovery instead of being reported as `parse_error`.
 *
 * Pure module — no React, no DOM. Easy to unit test.
 */

export type ParsedChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'parse_error'; raw: string };

const OPEN_TAG = '<tool_call>';
const CLOSE_TAG = '</tool_call>';

export class ToolCallStreamParser {
  private buffer = '';
  private state: 'text' | 'in_tool_call' = 'text';

  /**
   * Feed a new delta. Returns parsed chunks that are now complete (text
   * outside tool_call regions, or a fully-closed tool_call).
   *
   * Partial open/close tags are kept in the buffer until enough data arrives.
   */
  feed(delta: string): ParsedChunk[] {
    this.buffer += delta;
    const out: ParsedChunk[] = [];

    while (this.buffer.length > 0) {
      if (this.state === 'text') {
        const idx = this.buffer.indexOf(OPEN_TAG);
        if (idx === -1) {
          // The open tag could still arrive in the next delta. Yield all but
          // the trailing OPEN_TAG.length - 1 characters so we don't ship part
          // of the tag as text.
          const safeYield = this.buffer.length - (OPEN_TAG.length - 1);
          if (safeYield > 0) {
            const text = this.buffer.slice(0, safeYield);
            if (text) out.push({ type: 'text', text });
            this.buffer = this.buffer.slice(safeYield);
          }
          break;
        }
        if (idx > 0) {
          out.push({ type: 'text', text: this.buffer.slice(0, idx) });
        }
        this.buffer = this.buffer.slice(idx + OPEN_TAG.length);
        this.state = 'in_tool_call';
      } else {
        const idx = this.buffer.indexOf(CLOSE_TAG);
        if (idx === -1) break;
        const body = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + CLOSE_TAG.length);
        this.state = 'text';
        out.push(...parseToolCallBody(body));
      }
    }

    return out;
  }

  /** Flush remaining buffer (call at stream end). */
  flush(): ParsedChunk[] {
    const out: ParsedChunk[] = [];
    if (this.state === 'in_tool_call') {
      // Unclosed tool_call at EOS — `parseToolCallBody` will rebalance braces
      // internally and retry, so a truncated JSON tail still parses.
      out.push(...parseToolCallBody(this.buffer.trim()));
    } else if (this.buffer.length > 0) {
      out.push({ type: 'text', text: this.buffer });
    }
    this.buffer = '';
    this.state = 'text';
    return out;
  }
}

// ---------------------------------------------------------------------------
// Tolerant body parsing — ported from the PoC v3 parser.
// ---------------------------------------------------------------------------

/**
 * Walk `text` and return each top-level balanced `{...}` substring.
 * Strings and escape sequences are honoured so braces inside `"..."` don't
 * disturb the nesting count. This is the core primitive that lets us tolerate
 * multi-call emission (`{...},{...}`) inside one `<tool_call>` tag.
 */
function extractBalancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/**
 * If a JSON-ish string has unbalanced `{`, `[`, or an unterminated string,
 * append matching closers so it can be parsed. Returns the rebalanced string,
 * or the original if nothing needed fixing.
 */
function rebalanceJson(s: string): string {
  let depth = 0;
  let bracket = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
  }
  let fixed = s;
  if (inString) fixed += '"';
  while (bracket > 0) {
    fixed += ']';
    bracket--;
  }
  while (depth > 0) {
    fixed += '}';
    depth--;
  }
  return fixed;
}

interface RawCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Parse a single tool_call body. Tolerates:
 *  - `{"name":"...","arguments":{...}}`           — canonical
 *  - `{"name":"...","args":{...}}`                — alternate key
 *  - `name_here{"...":...}`                       — name outside JSON
 *  - `{...}` with trailing garbage after the JSON — extra chars after `}`
 *
 * Returns null if no recoverable interpretation exists.
 */
function parseSingleCall(body: string): RawCall | null {
  const trimmed = body.trim();

  // Form: name_prefix{...} — the prefix is the tool name. Inner JSON is the
  // args bag (or has nested `arguments` / `args`). We always trust the
  // prefix as the tool name — `inner.name` may exist but it's typically the
  // first argument (e.g. `create_wordbook{"name":"X"}`) where the model
  // forgot to wrap it in `arguments`.
  const prefixMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\{[\s\S]*\})\s*$/);
  if (prefixMatch) {
    try {
      const inner = JSON.parse(prefixMatch[2]) as Record<string, unknown>;
      const args =
        (inner.arguments as Record<string, unknown> | undefined) ??
        (inner.args as Record<string, unknown> | undefined) ??
        inner;
      return { name: prefixMatch[1], args };
    } catch {
      /* fall through */
    }
  }

  // Form: {"name":"...","arguments":{...}} possibly with trailing garbage
  const objs = extractBalancedObjects(trimmed);
  if (objs.length === 0) return null;
  for (const objStr of objs) {
    try {
      const obj = JSON.parse(objStr) as Record<string, unknown>;
      if (typeof obj.name !== 'string') continue;
      const args =
        (obj.arguments as Record<string, unknown> | undefined) ??
        (obj.args as Record<string, unknown> | undefined) ??
        {};
      return { name: obj.name as string, args };
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Parse a single tool_call body into ONE OR MORE ParsedChunks.
 * Returns a single `parse_error` chunk when no calls could be recovered.
 *
 * Priority:
 *   1. Multi-call: a body with multiple balanced objects (`{...},{...},...`)
 *      yields one call per object.
 *   2. Single-call (canonical or with trailing garbage / name-prefix).
 *   3. Auto-close: if neither path produced calls, rebalance braces and retry
 *      once. Lets us recover truncated JSON like `{"name":"x","args":{}` (no
 *      outer close brace).
 */
function parseToolCallBody(body: string): ParsedChunk[] {
  const fromBalanced = (text: string): ParsedChunk[] => {
    const balanced = extractBalancedObjects(text);
    if (balanced.length <= 1) return [];
    const out: ParsedChunk[] = [];
    for (const objStr of balanced) {
      try {
        const obj = JSON.parse(objStr) as Record<string, unknown>;
        if (typeof obj.name === 'string') {
          const args =
            (obj.arguments as Record<string, unknown> | undefined) ??
            (obj.args as Record<string, unknown> | undefined) ??
            {};
          out.push({ type: 'tool_call', name: obj.name as string, args });
        }
      } catch {
        /* skip malformed object */
      }
    }
    return out;
  };

  const multi = fromBalanced(body);
  if (multi.length > 0) return multi;

  const single = parseSingleCall(body);
  if (single) return [{ type: 'tool_call', name: single.name, args: single.args }];

  // Auto-close retry: rebalance braces and try once more.
  const rebalanced = rebalanceJson(body);
  if (rebalanced !== body) {
    const multi2 = fromBalanced(rebalanced);
    if (multi2.length > 0) return multi2;
    const single2 = parseSingleCall(rebalanced);
    if (single2) return [{ type: 'tool_call', name: single2.name, args: single2.args }];
  }

  return [{ type: 'parse_error', raw: body }];
}
