/**
 * Stream parser for `<tool_call>...</tool_call>` segments inside a streaming
 * assistant response. Buffers across token boundaries so a tag split across
 * two chunks is still captured.
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
        out.push(parseToolCallBody(body));
      }
    }

    return out;
  }

  /** Flush remaining buffer (call at stream end). */
  flush(): ParsedChunk[] {
    const out: ParsedChunk[] = [];
    if (this.state === 'in_tool_call') {
      // Unclosed tool_call at EOS — yield as parse error.
      out.push({ type: 'parse_error', raw: this.buffer });
    } else if (this.buffer.length > 0) {
      out.push({ type: 'text', text: this.buffer });
    }
    this.buffer = '';
    this.state = 'text';
    return out;
  }
}

function parseToolCallBody(body: string): ParsedChunk {
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;
    if (typeof obj.name !== 'string') {
      return { type: 'parse_error', raw: body };
    }
    const args = (obj.arguments ?? obj.args ?? {}) as Record<string, unknown>;
    return { type: 'tool_call', name: obj.name as string, args };
  } catch {
    return { type: 'parse_error', raw: body };
  }
}
