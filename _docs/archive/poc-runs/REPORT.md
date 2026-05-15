# PoC Aggregate Report (3 run(s))

## Per-run summary
| Run | Total | Pass | Fail | Pass% | Avg ms |
|-----|-------|------|------|-------|--------|
| 1 | 10 | 6 | 4 | 60.0% | 7283 |
| 2 | 10 | 6 | 4 | 60.0% | 6626 |
| 3 | 10 | 6 | 4 | 60.0% | 6824 |
| **TOTAL** | 30 | 18 | 12 | 60.0% | — |

## Per-scenario across runs
| Scenario | Run1 | Run2 | Run3 | Consistency |
|----------|------|------|------|-------------|
| amb-delete-no-target | ✓ | ✓ | ✓ | stable |
| fp-explain-word | ✗ | ✗ | ✗ | always-fail |
| fp-meta-comment | ✓ | ✓ | ✓ | stable |
| multi-add-batch | ✗ | ✗ | ✗ | always-fail |
| read-search | ✓ | ✓ | ✗ | flaky |
| tp-add-to-wordbook | ✓ | ✓ | ✓ | stable |
| tp-add-word | ✓ | ✓ | ✓ | stable |
| tp-create-wordbook | ✓ | ✗ | ✗ | flaky |
| tp-delete-word | ✗ | ✗ | ✓ | flaky |
| tp-set-mastered | ✗ | ✓ | ✓ | flaky |

## Verdict: **❌ NO-GO** (60.0% across all runs; threshold 90%)

## Failure reasons
- Run 1 / tp-delete-word: expected exactly one delete_word, got <unparsed>
    raw head: <tool_call>{"name":"delete_word","arguments":{ ⏎   "wordId":"w-1" ⏎ }</tool_call>
- Run 1 / tp-set-mastered: expected exactly one set_mastered, got <unparsed>
    raw head: <tool_call>{"name":"set_mastered","arguments":{ ⏎   "wordId":"w-1", ⏎   "mastered":true ⏎ }</tool_call>
- Run 1 / multi-add-batch: expected >=5 calls, got 1
    raw head: <tool_call>{"name":"add_word_to_wordbook","arguments": {"wordId":"...", "wordbookId":"wb-1"}}</tool_call>
- Run 1 / fp-explain-word: expected no tool, got search_words
    raw head: <tool_call>{"name":"search_words","arguments":{"query":"桜"}}</tool_call>
- Run 2 / tp-delete-word: expected exactly one delete_word, got <unparsed>
    raw head: <tool_call>{"name":"delete_word","arguments":{"wordId":"w-1" මො"}</tool_call>
- Run 2 / tp-create-wordbook: expected exactly one create_wordbook, got <unparsed>
    raw head: <tool_call>{"name":"create_wordbook","arguments":{ ⏎   "name":"일본 봄", ⏎   "description":"일본 봄 단어장" ⏎ }</tool_call>
- Run 2 / multi-add-batch: expected >=5 calls, got 1
    raw head: <tool_call>{"name":"add_word_to_wordbook","arguments":{"wordId":"term1","wordbookId":"wb-1"}},{"name":"add_word_to_wordbook","arguments":{"wordId":"term2","wordbookId":"wb-1"}},{"name":"add_word_to_wo
- Run 2 / fp-explain-word: expected no tool, got search_words
    raw head: <tool_call>{"name":"search_words","arguments": {"query":"桜"}}</tool_call>
- Run 3 / tp-create-wordbook: expected exactly one create_wordbook, got <unparsed>
    raw head: <tool_call>create_wordbook{"name":"일본 봄"}</tool_call>
- Run 3 / multi-add-batch: expected >=5 calls, got 1
    raw head: <tool_call>{"name":"add_word_to_wordbook","arguments":{ ⏎   "wordId":"1", ⏎   "wordbookId":"wb-1" ⏎ ,  "term":"花", ⏎   "reading":"はな", ⏎   "meaning":"꽃" ⏎ ,  "jlptLevel":2 ⏎ ,  "wordId":"2", ⏎   "wordbookId":"wb-1" ⏎  
- Run 3 / fp-explain-word: expected no tool, got search_words
    raw head: <tool_call>{"name":"search_words","arguments": {"query":"桜"}}</tool_call>
- Run 3 / read-search: expected exactly one search_words, got <unparsed>
    raw head: <tool_call>{"name":"search_words","arguments":{"query":"桜"}}$$</tool_call>
