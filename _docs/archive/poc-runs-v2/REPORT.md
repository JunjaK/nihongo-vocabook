# PoC Aggregate Report (3 run(s))

## Per-run summary
| Run | Total | Pass | Fail | Pass% | Avg ms |
|-----|-------|------|------|-------|--------|
| 1 | 10 | 8 | 2 | 80.0% | 7905 |
| 2 | 10 | 5 | 5 | 50.0% | 5985 |
| 3 | 10 | 7 | 3 | 70.0% | 5414 |
| **TOTAL** | 30 | 20 | 10 | 66.7% | — |

## Per-scenario across runs
| Scenario | Run1 | Run2 | Run3 | Consistency |
|----------|------|------|------|-------------|
| amb-delete-no-target | ✓ | ✗ | ✓ | flaky |
| fp-explain-word | ✓ | ✓ | ✓ | stable |
| fp-meta-comment | ✓ | ✓ | ✓ | stable |
| multi-add-batch | ✗ | ✗ | ✗ | always-fail |
| read-search | ✓ | ✓ | ✗ | flaky |
| tp-add-to-wordbook | ✓ | ✗ | ✓ | flaky |
| tp-add-word | ✓ | ✗ | ✓ | flaky |
| tp-create-wordbook | ✓ | ✗ | ✗ | flaky |
| tp-delete-word | ✗ | ✓ | ✓ | flaky |
| tp-set-mastered | ✓ | ✓ | ✓ | stable |

## Verdict: **❌ NO-GO** (66.7% across all runs; threshold 90%)

## Failure reasons
- Run 1 / tp-delete-word: expected exactly one delete_word, got none
    raw head: <tool_call>{"name":"delete_word","arguments":{"wordId":"w-1" general_id_for_wordbook_id_for_wordbook_id_for_wordbook_id_for_wordbook_id_for_wordbook_id_for_wordbook_id_for_wordbook_id_for_wordbook_id_
- Run 1 / multi-add-batch: expected >=5 calls, got 4
    raw head: <tool_call>{"name":"add_word_to_wordbook","arguments": {"wordbookId": "wb-1", "wordId": "word1"}}</tool_call> ⏎ <tool_call>{"name":"add_word_to_wordbook","arguments": {"wordbookId": "wb-1", "wordId": "w
- Run 2 / tp-add-word: expected exactly one add_word, got none
    raw head: <tool_call>{"name":"add_word","arguments":{"term":"桜","reading":"さくら","meaning":"벚꽃"}},
- Run 2 / tp-create-wordbook: expected exactly one create_wordbook, got create_wordbook,일본 봄
    raw head: <tool_call>create_wordbook>{"name":"create_wordbook","arguments":{"name":"일본 봄"}}</tool_call><tool_call>create_wordbook>{"name":"일본 봄"}</tool_call>
- Run 2 / tp-add-to-wordbook: expected exactly one add_word_to_wordbook, got add_word
    raw head: <tool_call>{"name":"add_word","arguments": {"term":"寿司","reading":"すし","meaning":"초밥","jlptLevel":null}}</tool_call>
- Run 2 / multi-add-batch: expected >=5 calls, got 1
    raw head: <tool_call>{"name":"search_words","arguments":{"limit":5,"query":"봄에 어울리는 단어"}}</tool_call>
- Run 2 / amb-delete-no-target: expected clarification, got tool calls: delete_word
    raw head: User: 이거 빼줘 ⏎ <tool_call>{"name":"delete_word","arguments":{"wordId":"..."}}</tool_call>
- Run 3 / tp-create-wordbook: expected exactly one create_wordbook, got <unparsed>
    raw head: <tool_call>{"name":"create_wordbook","arguments": {"name": "일본 봄"}</tool_call>
- Run 3 / multi-add-batch: expected >=5 calls, got 1
    raw head: <tool_call>{"name":"add_word_to_wordbook","arguments":{"wordId":"..." ,"wordbookId":"wb-1"}}</tool_call>
- Run 3 / read-search: expected exactly one search_words, got <unparsed>
    raw head: <tool_call>{"name":"search_words","arguments": {"query": "桜"}</tool_call>
