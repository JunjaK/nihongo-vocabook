# `_docs/` Layout

Project documentation lives in three lifecycle buckets. Pick the one that matches
the doc's current state — don't leave docs at the `_docs/` root.

## `active/` — in flight

Plans currently being implemented, handoffs in progress, items waiting on user
review, or operational guides that are kept up-to-date with the running system.
Read these first when starting work on the matching feature.

| File | What |
|------|------|
| [ai-assistant-handoff-testing.md](active/ai-assistant-handoff-testing.md) | OCR regression + physical-device tests outstanding for the AI Assistant |
| [ai-assistant-phase1-implementation-notes.md](active/ai-assistant-phase1-implementation-notes.md) | Phase 1–2.5 implementation notes, NEEDS REVIEW items |
| [daily-dict-enrichment-routine.md](active/daily-dict-enrichment-routine.md) | Routine for filling missing example sentences |
| [daily-dict-enrichment-schedule.md](active/daily-dict-enrichment-schedule.md) | Schedule registration steps |
| [dictionary-example-gen-auth-bug.md](active/dictionary-example-gen-auth-bug.md) | Open auth bug in example generation flow |
| [ios-app-deployment.md](active/ios-app-deployment.md) | EAS Build → TestFlight deployment guide |
| [mobile-setup.md](active/mobile-setup.md) | Clean-clone setup for the iOS app (model + entitlement) |
| [scan-dictionary-fuzzy-match.md](active/scan-dictionary-fuzzy-match.md) | OCR term → dictionary fuzzy match — feedback pending |
| [ui-renewal-plan.md](active/ui-renewal-plan.md) | UI renewal (Phase 1–4 done, visual verification pending) |

## `complete/` — shipped, reference

Plans that landed and are kept around as the canonical write-up of how the
shipped feature works. Useful when revisiting why a particular design choice
was made. Don't put new work here.

| File | Feature |
|------|---------|
| [ai-assistant-and-footer-redesign.md](complete/ai-assistant-and-footer-redesign.md) | AI Assistant + footer redesign spec |
| [ai-assistant-phase0-plan.md](complete/ai-assistant-phase0-plan.md) | Phase 0 PoC plan with GO verdict (90% accuracy) |
| [ai-chat-poc-results.md](complete/ai-chat-poc-results.md) | XCFramework audit + streaming C API inspection |
| [dictionary-search-improvements.md](complete/dictionary-search-improvements.md) | Dictionary search rewrite |
| [monorepo-expo-plan.md](complete/monorepo-expo-plan.md) | Bun workspaces + Expo migration |
| [ocr-gemma4-replacement-plan.md](complete/ocr-gemma4-replacement-plan.md) | Cloud OCR LLM → on-device Gemma 4 |
| [ocr-llm-accuracy-finetuning-2026-02.md](complete/ocr-llm-accuracy-finetuning-2026-02.md) | OCR/LLM accuracy tuning |
| [ocr-scan-plan.md](complete/ocr-scan-plan.md) | Image → word extraction flow |
| [quiz-enhance.md](complete/quiz-enhance.md) | Quiz/practice/SRS architecture |
| [quiz-improvements-2026-02.md](complete/quiz-improvements-2026-02.md) | Quiz UI/data fixes |
| [word-examples-dict-link.md](complete/word-examples-dict-link.md) | Migration 025 — examples keyed by dictionary entry |
| [wordbook-add-from-subscribed-fixes.md](complete/wordbook-add-from-subscribed-fixes.md) | Subscribed-wordbook → my words stability |

## `archive/` — history, read-only

One-shot analyses, superseded plans, PoC run artifacts. Don't update these;
just keep them for "what did 2026-02 think about this?" lookups.

| Item | Why archived |
|------|--------------|
| `plan.md` | Original project-level plan, long superseded |
| `senior-review-2026-02.md` | One-shot review report — all issues resolved in code |
| `quiz-flashcard-analysis-2026-02.md` | Pre-improvement analysis report |
| `quiz-split-review-2026-02.md` | Post-split review |
| `quiz-system-analysis-2026-02.md` | System analysis report |
| `ui-ux-audit.md` | 2026-02 design audit |
| `audit-word-dict-link-report.json` | One-shot data audit |
| `poc-runs/`, `poc-runs-v2/`, `poc-runs-v3/` | AI Assistant Phase 0 PoC raw run JSONs + scoring reports |
| `ocr-test-img/` | OCR test fixtures from earlier prototyping |

## Adding a new doc

1. Save under `_docs/active/<feature-name>.md` with frontmatter:
   ```markdown
   # Feature Name
   > Status: Planning | In Progress | Feedback
   > Updated: YYYY-MM-DD
   ```
2. When the feature ships and the doc still describes current behavior, `git mv` to `_docs/complete/`.
3. When the doc is superseded or describes an abandoned path, `git mv` to `_docs/archive/`.
4. Update this README's index.

Long-form writeups that aren't actionable plans (e.g. journey blog posts) live in `_notes/` instead.
