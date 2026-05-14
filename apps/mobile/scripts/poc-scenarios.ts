/**
 * Phase 0 PoC scenario catalog — locked input set used to score Gemma 4 E2B
 * int4 function-calling capability.
 *
 * Each scenario expresses ONE of four expectations:
 *   - expectTool        : exactly one tool_call with this name
 *   - expectMultiToolMinCount : at least N tool_calls in the same turn
 *   - expectNoTool      : no tool_calls (conversational / informational ask)
 *   - expectClarification : no tool_calls (model should ask back for missing target)
 *
 * Context blocks mimic the Phase 1 scope-context injection. Kept terse so
 * the PoC measures tool-calling behavior, not context comprehension.
 *
 * Scoring lives in `poc-tool-calling.ts`. Gate criteria live in
 * `_docs/ai-assistant-phase0-plan.md`.
 */

export interface PocScenario {
  id: string;
  ask: string;
  expectTool?: string;
  expectMultiToolMinCount?: number;
  expectNoTool?: boolean;
  expectClarification?: boolean;
  context?: string;
}

export const SCENARIOS: PocScenario[] = [
  // ---- True-positive single-tool ----
  {
    id: 'tp-add-word',
    ask: '「桜」を単語として追加して。読みは「さくら」、意味は「벚꽃」。',
    expectTool: 'add_word',
  },
  {
    id: 'tp-delete-word',
    ask: '「桜」 삭제해줘',
    expectTool: 'delete_word',
    context: [
      'CURRENT WORD:',
      '  id: w-1',
      '  term: 桜',
      '  reading: さくら',
      '  meaning: 벚꽃',
    ].join('\n'),
  },
  {
    id: 'tp-create-wordbook',
    ask: '단어장 「일본 봄」 만들어줘',
    expectTool: 'create_wordbook',
  },
  {
    id: 'tp-add-to-wordbook',
    ask: '寿司를 「일식」 단어장에 추가해줘',
    expectTool: 'add_word_to_wordbook',
    context: [
      'WORDBOOK:',
      '  id: wb-1',
      '  name: 일식',
      '',
      'WORDS YOU CAN REFERENCE BY ID:',
      '  w-2 — 寿司 (すし) — 초밥',
    ].join('\n'),
  },
  {
    id: 'tp-set-mastered',
    ask: '「桜」 암기완료로 표시해줘',
    expectTool: 'set_mastered',
    context: [
      'CURRENT WORD:',
      '  id: w-1',
      '  term: 桜',
    ].join('\n'),
  },

  // ---- Multi-tool batch in one turn ----
  {
    id: 'multi-add-batch',
    ask: '봄에 어울리는 단어 다섯 개 골라서 「일본 봄」 단어장에 추가해줘',
    expectMultiToolMinCount: 5,
    context: [
      'WORDBOOK:',
      '  id: wb-1',
      '  name: 일본 봄',
    ].join('\n'),
  },

  // ---- False-positive guards ----
  {
    id: 'fp-explain-word',
    ask: '「桜」 어떻게 읽어?',
    expectNoTool: true,
  },
  {
    id: 'fp-meta-comment',
    ask: '나는 단어 외우는 게 너무 어려워',
    expectNoTool: true,
  },

  // ---- Ambiguous → clarification ----
  {
    id: 'amb-delete-no-target',
    ask: '이거 빼줘',
    expectClarification: true,
  },

  // ---- Read-only intent (should auto-run, not block on confirm) ----
  {
    id: 'read-search',
    ask: '내 단어 중에 「桜」 있어?',
    expectTool: 'search_words',
  },
];
