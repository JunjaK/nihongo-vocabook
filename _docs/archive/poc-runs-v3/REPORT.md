# PoC Aggregate Report (3 run(s))

## Per-run summary
| Run | Total | Pass | Fail | Pass% | Avg ms |
|-----|-------|------|------|-------|--------|
| 1 | 10 | 8 | 2 | 80.0% | 6579 |
| 2 | 10 | 10 | 0 | 100.0% | 6281 |
| 3 | 10 | 9 | 1 | 90.0% | 6278 |
| **TOTAL** | 30 | 27 | 3 | 90.0% | — |

## Per-scenario across runs
| Scenario | Run1 | Run2 | Run3 | Consistency |
|----------|------|------|------|-------------|
| amb-delete-no-target | ✓ | ✓ | ✗ | flaky |
| fp-explain-word | ✓ | ✓ | ✓ | stable |
| fp-meta-comment | ✓ | ✓ | ✓ | stable |
| multi-add-batch | ✗ | ✓ | ✓ | flaky |
| read-search | ✓ | ✓ | ✓ | stable |
| tp-add-to-wordbook | ✓ | ✓ | ✓ | stable |
| tp-add-word | ✓ | ✓ | ✓ | stable |
| tp-create-wordbook | ✗ | ✓ | ✓ | flaky |
| tp-delete-word | ✓ | ✓ | ✓ | stable |
| tp-set-mastered | ✓ | ✓ | ✓ | stable |

## Verdict: **✅ GO** (90.0% across all runs; threshold 90%)

## Failure reasons
- Run 1 / tp-create-wordbook: expected exactly one create_wordbook, got <unparsed>
    raw head: <tool_call>create_wordbook{name:<|"|>일본 봄<|"|>}</tool_call>
- Run 1 / multi-add-batch: expected >=5 calls, got 0
    raw head: 어떤 단어들을 찾고 싶으신가요? "봄에 어울리는 단어"라는 요청만으로는 제가 어떤 단어를 골라야 할지 알기 어렵습니다. 혹시 찾고 싶은 단어의 주제나 분위기가 있으신가요? ⏎  ⏎ 예를 들어, '꽃', '날씨', '감정', '활동' 등 어떤 범주에서 단어를 찾고 싶으신지 알려주시면 더 적절하게 골라드릴 수 있습니다.
- Run 3 / amb-delete-no-target: expected clarification, got tool calls: remove_word_from_wordbook
    raw head: <tool_call>{"name":"remove_word_from_wordbook","arguments": {"wordId": "..." , "wordbookId": "..."}}</tool_call>
