import { describe, it, expect } from 'vitest';
import { ToolCallStreamParser, type ParsedChunk } from './parser';

function feedAll(p: ToolCallStreamParser, chunks: string[]): ParsedChunk[] {
  const out: ParsedChunk[] = [];
  for (const c of chunks) out.push(...p.feed(c));
  out.push(...p.flush());
  return out;
}

/**
 * Coalesce consecutive `text` chunks. The parser is intentionally conservative
 * (holds trailing OPEN_TAG.length-1 chars in case a partial tag is forming),
 * so callers should reassemble streaming text by joining adjacent deltas —
 * which is exactly what `ChatMessageList` does in practice.
 */
function coalesce(chunks: ParsedChunk[]): ParsedChunk[] {
  const out: ParsedChunk[] = [];
  for (const c of chunks) {
    const last = out[out.length - 1];
    if (c.type === 'text' && last && last.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + c.text };
    } else {
      out.push(c);
    }
  }
  return out;
}

describe('ToolCallStreamParser', () => {
  it('yields plain text when no tool_call is present', () => {
    const p = new ToolCallStreamParser();
    const out = coalesce(feedAll(p, ['hello ', 'world']));
    expect(out).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('parses a single complete tool_call in one delta', () => {
    const p = new ToolCallStreamParser();
    const out = feedAll(p, [
      '<tool_call>{"name":"add_word","arguments":{"term":"猫"}}</tool_call>',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: 'tool_call',
      name: 'add_word',
      args: { term: '猫' },
    });
  });

  it('captures text before and after a tool_call', () => {
    const p = new ToolCallStreamParser();
    const out = coalesce(
      feedAll(p, [
        'Sure, I will add it. <tool_call>{"name":"x","arguments":{}}</tool_call> Done.',
      ]),
    );
    expect(out).toEqual([
      { type: 'text', text: 'Sure, I will add it. ' },
      { type: 'tool_call', name: 'x', args: {} },
      { type: 'text', text: ' Done.' },
    ]);
  });

  it('handles tool_call open tag split across deltas', () => {
    const p = new ToolCallStreamParser();
    const out = coalesce(
      feedAll(p, [
        'prefix <tool',
        '_call>{"name":"a","arguments":{}}</tool_call> suffix',
      ]),
    );
    expect(out).toEqual([
      { type: 'text', text: 'prefix ' },
      { type: 'tool_call', name: 'a', args: {} },
      { type: 'text', text: ' suffix' },
    ]);
  });

  it('handles tool_call close tag split across deltas', () => {
    const p = new ToolCallStreamParser();
    const out = feedAll(p, [
      '<tool_call>{"name":"a","arguments":{}}</tool',
      '_call>',
    ]);
    expect(out).toEqual([
      { type: 'tool_call', name: 'a', args: {} },
    ]);
  });

  it('parses multiple tool_calls in one assistant turn', () => {
    const p = new ToolCallStreamParser();
    const out = coalesce(
      feedAll(p, [
        '<tool_call>{"name":"a","arguments":{"i":1}}</tool_call>',
        'between ',
        '<tool_call>{"name":"b","arguments":{"i":2}}</tool_call>',
      ]),
    );
    expect(out).toEqual([
      { type: 'tool_call', name: 'a', args: { i: 1 } },
      { type: 'text', text: 'between ' },
      { type: 'tool_call', name: 'b', args: { i: 2 } },
    ]);
  });

  it('reports parse_error for malformed JSON inside tool_call', () => {
    const p = new ToolCallStreamParser();
    const out = feedAll(p, ['<tool_call>not json</tool_call>']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'parse_error' });
  });

  it('reports parse_error when "name" field is missing', () => {
    const p = new ToolCallStreamParser();
    const out = feedAll(p, ['<tool_call>{"arguments":{}}</tool_call>']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'parse_error' });
  });

  it('accepts both "arguments" and "args" keys', () => {
    const out = feedAll(new ToolCallStreamParser(), [
      '<tool_call>{"name":"x","args":{"y":1}}</tool_call>',
    ]);
    expect(out).toEqual([{ type: 'tool_call', name: 'x', args: { y: 1 } }]);
  });

  it('flush() recovers an unclosed tool_call via auto-close', () => {
    // v3 polish: at EOS, rebalance unbalanced braces. Body `{"name":"a"`
    // becomes parseable as `{"name":"a"}` → tool_call(a, {}).
    const p = new ToolCallStreamParser();
    p.feed('<tool_call>{"name":"a"');
    const out = p.flush();
    expect(out).toEqual([{ type: 'tool_call', name: 'a', args: {} }]);
  });

  it('flush() still emits parse_error when recovery cannot find a name', () => {
    const p = new ToolCallStreamParser();
    p.feed('<tool_call>not even close');
    const out = p.flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'parse_error' });
  });

  it('flush() emits remaining text outside tool_call (joined across feed+flush)', () => {
    const p = new ToolCallStreamParser();
    const fed = p.feed('partial tail');
    const flushed = p.flush();
    const out = coalesce([...fed, ...flushed]);
    expect(out).toEqual([{ type: 'text', text: 'partial tail' }]);
  });

  it('never emits a partial open-tag prefix as text — joined output stays consistent', () => {
    const p = new ToolCallStreamParser();
    const first = p.feed('abc<tool_ca');
    const flushed = p.flush();
    const joined = coalesce([...first, ...flushed]);
    // The whole `abc<tool_ca` is text because no close tag is found and no
    // open tag completes either — flush() emits whatever was held back.
    expect(joined).toEqual([{ type: 'text', text: 'abc<tool_ca' }]);
  });

  // ---- v3 polish: tolerance for model-generated quirks ---------------------

  it('splits a single tag containing multiple comma-separated calls', () => {
    const out = feedAll(new ToolCallStreamParser(), [
      '<tool_call>' +
        '{"name":"add_word_to_wordbook","arguments":{"wordId":"w1","wordbookId":"wb-1"}},' +
        '{"name":"add_word_to_wordbook","arguments":{"wordId":"w2","wordbookId":"wb-1"}},' +
        '{"name":"add_word_to_wordbook","arguments":{"wordId":"w3","wordbookId":"wb-1"}}' +
        '</tool_call>',
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.type === 'tool_call')).toBe(true);
    expect((out[0] as { args: Record<string, unknown> }).args).toEqual({
      wordId: 'w1',
      wordbookId: 'wb-1',
    });
  });

  it('recovers a tool_call with name outside the JSON body', () => {
    const out = feedAll(new ToolCallStreamParser(), [
      '<tool_call>create_wordbook{"name":"일본 봄"}</tool_call>',
    ]);
    expect(out).toEqual([
      { type: 'tool_call', name: 'create_wordbook', args: { name: '일본 봄' } },
    ]);
  });

  it('ignores trailing garbage after a balanced JSON object', () => {
    const out = feedAll(new ToolCallStreamParser(), [
      '<tool_call>{"name":"search_words","arguments":{"query":"桜"}}$$</tool_call>',
    ]);
    expect(out).toEqual([
      { type: 'tool_call', name: 'search_words', args: { query: '桜' } },
    ]);
  });

  it('handles pretty-printed JSON with newlines', () => {
    const out = feedAll(new ToolCallStreamParser(), [
      '<tool_call>{\n  "name":"create_wordbook",\n  "arguments":{\n    "name":"일본 봄"\n  }\n}</tool_call>',
    ]);
    expect(out).toEqual([
      { type: 'tool_call', name: 'create_wordbook', args: { name: '일본 봄' } },
    ]);
  });

  it('auto-closes a tool_call body with an unterminated inner object', () => {
    // Model truncates: `{"name":"search_words","arguments":{"query":"桜"}` (missing outer `}`)
    const out = feedAll(new ToolCallStreamParser(), [
      '<tool_call>{"name":"search_words","arguments":{"query":"桜"}</tool_call>',
    ]);
    expect(out).toEqual([
      { type: 'tool_call', name: 'search_words', args: { query: '桜' } },
    ]);
  });

  it('permissive flush: tool_call opens but never closes — still recovers', () => {
    const p = new ToolCallStreamParser();
    p.feed('<tool_call>{"name":"delete_word","arguments":{"wordId":"w1"');
    const out = p.flush();
    expect(out).toEqual([
      { type: 'tool_call', name: 'delete_word', args: { wordId: 'w1' } },
    ]);
  });
});
