/**
 * Phase 0 PoC runner — drives the scenario catalog against the on-device
 * Gemma 4 E2B engine via runTextInference, parses tool_call tags from the
 * raw model output, and scores each scenario against the gate criteria.
 *
 * Runs inside the app (not on the Node host) because LiteRT-LM requires the
 * device-resident engine. The dev-only `apps/mobile/src/app/_debug-poc.tsx`
 * screen drives this from a button tap.
 *
 * Gate criteria live in `_docs/ai-assistant-phase0-plan.md`.
 */

import type { AiToolDef } from '../modules/nivoca-ai/src/NivocaAi.types';
import { runTextInference } from '../src/lib/ai/inference-text';
import { SCENARIOS, type PocScenario } from './poc-scenarios';

// ---------------------------------------------------------------------------
// Tool catalog — mirrors Phase 1 Function Catalog in the spec.
// ---------------------------------------------------------------------------

const TOOL_CATALOG: AiToolDef[] = [
  {
    name: 'add_word',
    description:
      "Add a new Japanese vocabulary word to the user's personal list. Use when the user asks to add, save, register, or note a word.",
    parameters: {
      type: 'object',
      required: ['term', 'reading', 'meaning'],
      properties: {
        term: { type: 'string', maxLength: 10 },
        reading: { type: 'string' },
        meaning: { type: 'string' },
        jlptLevel: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: 'edit_word',
    description: "Edit an existing word's reading, meaning, or JLPT level.",
    parameters: {
      type: 'object',
      required: ['wordId'],
      properties: {
        wordId: { type: 'string' },
        term: { type: 'string', maxLength: 10 },
        reading: { type: 'string' },
        meaning: { type: 'string' },
        jlptLevel: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: 'delete_word',
    description: 'Permanently delete a word. Destructive — cannot be undone.',
    parameters: {
      type: 'object',
      required: ['wordId'],
      properties: { wordId: { type: 'string' } },
    },
  },
  {
    name: 'set_mastered',
    description:
      'Mark a word as mastered (true) or move it back to the active list (false).',
    parameters: {
      type: 'object',
      required: ['wordId', 'mastered'],
      properties: {
        wordId: { type: 'string' },
        mastered: { type: 'boolean' },
      },
    },
  },
  {
    name: 'create_wordbook',
    description: 'Create a new wordbook.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', maxLength: 50 },
        description: { type: 'string', maxLength: 200 },
      },
    },
  },
  {
    name: 'edit_wordbook',
    description: 'Rename or edit the description of a wordbook.',
    parameters: {
      type: 'object',
      required: ['wordbookId'],
      properties: {
        wordbookId: { type: 'string' },
        name: { type: 'string', maxLength: 50 },
        description: { type: 'string', maxLength: 200 },
      },
    },
  },
  {
    name: 'delete_wordbook',
    description:
      'Permanently delete a wordbook (does NOT delete the words). Destructive.',
    parameters: {
      type: 'object',
      required: ['wordbookId'],
      properties: { wordbookId: { type: 'string' } },
    },
  },
  {
    name: 'add_word_to_wordbook',
    description: 'Add an existing word to a wordbook.',
    parameters: {
      type: 'object',
      required: ['wordId', 'wordbookId'],
      properties: {
        wordId: { type: 'string' },
        wordbookId: { type: 'string' },
      },
    },
  },
  {
    name: 'remove_word_from_wordbook',
    description: 'Remove a word from a wordbook (does NOT delete the word).',
    parameters: {
      type: 'object',
      required: ['wordId', 'wordbookId'],
      properties: {
        wordId: { type: 'string' },
        wordbookId: { type: 'string' },
      },
    },
  },
  {
    name: 'search_words',
    description:
      "Search the user's vocabulary by term, reading, or meaning. Returns up to 20 matches.",
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', maximum: 20 },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool-call extraction + scoring
// ---------------------------------------------------------------------------

export interface ToolCallExtract {
  name: string;
  argsRaw: string;
  argsParsed: Record<string, unknown> | null;
  parseOk: boolean;
}

const TOOL_CALL_PATTERN = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const TOOL_CALL_OPEN_NO_CLOSE = /<tool_call>([\s\S]*?)(?=<tool_call>|$)/g;

/**
 * If a JSON-ish string has unbalanced `{` and `[`, append matching closers so
 * it can be parsed. Returns the rebalanced string, or the original if nothing
 * needed fixing.
 */
function rebalanceJson(s: string): string {
  let depth = 0;
  let bracket = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') { escape = true; continue; }
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
  while (bracket > 0) { fixed += ']'; bracket--; }
  while (depth > 0) { fixed += '}'; depth--; }
  return fixed;
}

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
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
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
 * Parse a single tool_call body. Tolerates:
 *  - `{"name":"...","arguments":{...}}`           — canonical
 *  - `{"name":"...","args":{...}}`                — alternate key
 *  - `name_here{"...":...}`                       — name prefix outside JSON
 *  - `{...}` with trailing garbage after the JSON — extra chars after `}`
 *
 * Returns null if no recoverable interpretation exists.
 */
function parseSingleCall(body: string): { name: string; args: Record<string, unknown> } | null {
  const trimmed = body.trim();

  // Form: name_prefix{...}
  const prefixMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\{[\s\S]*\})\s*$/);
  if (prefixMatch) {
    try {
      const inner = JSON.parse(prefixMatch[2]) as Record<string, unknown>;
      // If the inner already has `name`, prefer that; otherwise use the prefix.
      const name = typeof inner.name === 'string' ? inner.name : prefixMatch[1];
      const args = (inner.arguments ?? inner.args ?? inner) as Record<string, unknown>;
      // Strip name field out when the args bag was the inner object directly.
      if (args === inner) {
        const { name: _n, arguments: _a, args: _b, ...rest } = inner;
        return { name, args: rest };
      }
      return { name, args };
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
 * Parse a single tool_call body into one OR MORE calls. Tolerates multi-call
 * emission like `{"name":"a",...},{"name":"b",...}`.
 *
 * Priority:
 *   1. If the body contains multiple balanced objects, treat each as a call.
 *   2. Otherwise, fall back to single-call recovery (handles name-prefix shape
 *      and `{...}` with trailing garbage).
 */
function parseToolCallBody(body: string): Array<{ name: string; args: Record<string, unknown> }> {
  const balanced = extractBalancedObjects(body);
  if (balanced.length > 1) {
    const out: Array<{ name: string; args: Record<string, unknown> }> = [];
    for (const objStr of balanced) {
      try {
        const obj = JSON.parse(objStr) as Record<string, unknown>;
        if (typeof obj.name === 'string') {
          const args =
            (obj.arguments as Record<string, unknown> | undefined) ??
            (obj.args as Record<string, unknown> | undefined) ??
            {};
          out.push({ name: obj.name, args });
        }
      } catch {
        /* skip malformed */
      }
    }
    if (out.length > 0) return out;
  }

  const single = parseSingleCall(body);
  return single ? [single] : [];
}

export function extractToolCalls(raw: string): ToolCallExtract[] {
  const out: ToolCallExtract[] = [];
  // Find all <tool_call>...</tool_call> blocks. If the model failed to emit a
  // closing tag for some block, fall through to a permissive split that
  // accepts everything between two <tool_call> opens (or EOS) as the body.
  let matched = false;
  for (const match of raw.matchAll(TOOL_CALL_PATTERN)) {
    matched = true;
    const body = match[1].trim();
    const calls = parseToolCallBody(rebalanceJson(body));
    if (calls.length === 0) {
      out.push({ name: '<unparsed>', argsRaw: body, argsParsed: null, parseOk: false });
      continue;
    }
    for (const c of calls) {
      out.push({
        name: c.name,
        argsRaw: body,
        argsParsed: { name: c.name, arguments: c.args },
        parseOk: true,
      });
    }
  }
  if (matched) return out;

  // No properly-closed tool_call tags. Try the permissive form: anything
  // after `<tool_call>` up to next `<tool_call>` or end-of-string.
  for (const match of raw.matchAll(TOOL_CALL_OPEN_NO_CLOSE)) {
    const body = match[1].trim();
    if (!body) continue;
    const calls = parseToolCallBody(rebalanceJson(body));
    if (calls.length === 0) {
      out.push({ name: '<unparsed>', argsRaw: body, argsParsed: null, parseOk: false });
      continue;
    }
    for (const c of calls) {
      out.push({
        name: c.name,
        argsRaw: body,
        argsParsed: { name: c.name, arguments: c.args },
        parseOk: true,
      });
    }
  }
  return out;
}

export interface ScenarioResult {
  scenarioId: string;
  ask: string;
  rawOutput: string;
  durationMs: number;
  toolCalls: ToolCallExtract[];
  passed: boolean;
  failureReason?: string;
}

export interface Summary {
  total: number;
  passed: number;
  failed: number;
  truePositive: { passed: number; total: number };
  falsePositive: { passed: number; total: number };
  multiTool: { passed: number; total: number };
  clarification: { passed: number; total: number };
  meanDurationMs: number;
  parseRate: number;
}

function score(
  scn: PocScenario,
  calls: ToolCallExtract[],
): { passed: boolean; reason?: string } {
  if (scn.expectNoTool) {
    if (calls.length === 0) return { passed: true };
    return {
      passed: false,
      reason: `expected no tool, got ${calls.map((c) => c.name).join(',')}`,
    };
  }
  if (scn.expectClarification) {
    if (calls.length === 0) return { passed: true };
    return {
      passed: false,
      reason: `expected clarification, got tool calls: ${calls
        .map((c) => c.name)
        .join(',')}`,
    };
  }
  if (scn.expectMultiToolMinCount !== undefined) {
    if (calls.length >= scn.expectMultiToolMinCount) return { passed: true };
    return {
      passed: false,
      reason: `expected >=${scn.expectMultiToolMinCount} calls, got ${calls.length}`,
    };
  }
  if (scn.expectTool) {
    if (
      calls.length === 1 &&
      calls[0].name === scn.expectTool &&
      calls[0].parseOk
    ) {
      return { passed: true };
    }
    return {
      passed: false,
      reason: `expected exactly one ${scn.expectTool}, got ${calls
        .map((c) => c.name)
        .join(',') || 'none'}`,
    };
  }
  return { passed: false, reason: 'no expectation set' };
}

function summarize(results: ScenarioResult[]): Summary {
  const tp = results.filter(
    (r) => SCENARIOS.find((s) => s.id === r.scenarioId)?.expectTool,
  );
  const fp = results.filter(
    (r) => SCENARIOS.find((s) => s.id === r.scenarioId)?.expectNoTool,
  );
  const mt = results.filter(
    (r) =>
      SCENARIOS.find((s) => s.id === r.scenarioId)?.expectMultiToolMinCount,
  );
  const cl = results.filter(
    (r) => SCENARIOS.find((s) => s.id === r.scenarioId)?.expectClarification,
  );
  const allCalls = results.flatMap((r) => r.toolCalls);
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    truePositive: {
      passed: tp.filter((r) => r.passed).length,
      total: tp.length,
    },
    falsePositive: {
      passed: fp.filter((r) => r.passed).length,
      total: fp.length,
    },
    multiTool: {
      passed: mt.filter((r) => r.passed).length,
      total: mt.length,
    },
    clarification: {
      passed: cl.filter((r) => r.passed).length,
      total: cl.length,
    },
    meanDurationMs:
      results.reduce((acc, r) => acc + r.durationMs, 0) /
      Math.max(1, results.length),
    parseRate:
      allCalls.length === 0
        ? 1
        : allCalls.filter((c) => c.parseOk).length / allCalls.length,
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const SYSTEM_PREAMBLE = [
  "You are the user's Japanese vocabulary study assistant.",
  "You can use tools to interact with the user's words and wordbooks.",
  "Respond in the user's language (Korean unless the message is mostly Japanese).",
  '',
  'IMPORTANT — when to NOT call a tool:',
  '- If the user asks "what does X mean?" / "X 뜻이 뭐야?" / "X 무슨 뜻이야?" — answer directly with the meaning in natural language. Do NOT call search_words or any other tool just to explain a word.',
  '- If the user asks a meta question about the assistant itself (capabilities, how to use, etc.) — answer in natural language without any tool call.',
  '- Only call a tool when the user is requesting an action on their data (add/edit/delete/search/find).',
  '',
  'Example (explain only, no tool):',
  '  User: "桜 뜻이 뭐야?"',
  '  Assistant: "桜(さくら)는 「벚꽃」을 뜻합니다."',
].join('\n');

export async function runPoc(): Promise<{
  results: ScenarioResult[];
  summary: Summary;
}> {
  const results: ScenarioResult[] = [];
  for (const scn of SCENARIOS) {
    const systemContent = [SYSTEM_PREAMBLE, scn.context ?? '']
      .filter(Boolean)
      .join('\n\n');

    const t0 = Date.now();
    let raw = '';
    try {
      raw = await runTextInference({
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: systemContent }],
          },
          { role: 'user', content: [{ type: 'text', text: scn.ask }] },
        ],
        tools: TOOL_CATALOG,
      });
    } catch (e) {
      raw = `<error>${e instanceof Error ? e.message : String(e)}</error>`;
    }
    const elapsed = Date.now() - t0;
    const calls = extractToolCalls(raw);
    const { passed, reason } = score(scn, calls);
    results.push({
      scenarioId: scn.id,
      ask: scn.ask,
      rawOutput: raw,
      durationMs: elapsed,
      toolCalls: calls,
      passed,
      failureReason: reason,
    });
  }
  return { results, summary: summarize(results) };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function formatReport(
  summary: Summary,
  results: ScenarioResult[],
): string {
  const lines = [
    `Total: ${summary.passed}/${summary.total} passed (${summary.failed} failed)`,
    `True positive: ${summary.truePositive.passed}/${summary.truePositive.total}`,
    `False positive blocked: ${summary.falsePositive.passed}/${summary.falsePositive.total}`,
    `Multi-tool batched: ${summary.multiTool.passed}/${summary.multiTool.total}`,
    `Clarification: ${summary.clarification.passed}/${summary.clarification.total}`,
    `Mean duration: ${Math.round(summary.meanDurationMs)}ms`,
    `JSON parse rate: ${(summary.parseRate * 100).toFixed(0)}%`,
    '',
    '--- per scenario ---',
    ...results.map(
      (r) =>
        `[${r.passed ? 'PASS' : 'FAIL'}] ${r.scenarioId} (${r.durationMs}ms) — ${r.failureReason ?? 'ok'}`,
    ),
  ];
  return lines.join('\n');
}
