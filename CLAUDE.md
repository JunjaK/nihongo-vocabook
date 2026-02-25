# Nihongo VocaBook — Claude Code Configuration

Japanese vocabulary study PWA — Next.js 16 + React 19 + Tailwind CSS 4 + Shadcn UI

---

## Critical Thinking (TOP PRIORITY)

Always maintain a critical perspective on every request. Proactively identify and raise:
- **Flaws or gaps** in the proposed approach
- **Concerns** about side effects, edge cases, or unintended consequences
- **Improvements** that could lead to better code quality, consistency, or maintainability

Do NOT wait to be asked. If you spot an issue or a better alternative, raise it immediately. This ensures higher quality outcomes and prevents wasted effort.

---

## Investigation Rule (TOP PRIORITY)

When exploring or debugging code, if you hit a dead end or can't pinpoint the cause from code alone, **ask the user immediately** instead of continuing to dig endlessly. A quick question (requesting symptoms, error messages, screenshots, reproduction steps) is far more efficient than prolonged speculative exploration.

---

## TypeScript Error Zero Tolerance (TOP PRIORITY)

**TypeScript errors must NEVER remain unresolved.** Unless there is a truly exceptional case, all TS errors must be fixed before considering any task complete.

### Workflow
1. Make code changes
2. Verify no TypeScript errors in modified files
3. If TS errors exist → fix them immediately
4. If a TS error cannot be resolved → ask the user instead of ignoring or using `any`/`as` casts
5. Only then consider the task complete

---

## Pre-work Checklist

Before starting complex tasks, always check `_docs/`:

1. **Read `_docs/`** — Check if related documentation exists
2. **Reference related docs** — Read existing plans/implementation docs first
3. **After completion** — Update docs when creating new plans

```
_docs/
├── ocr-scan-plan.md              # OCR/Scan feature plan
├── quiz-improvements-2026-02.md  # Quiz improvements plan
└── ...                           # Other feature plans
```

---

## Claude Code Structure

```
.claude/
├── rules/           # Always-loaded rules (project, code-style, codebase-map)
├── skills/          # On-demand knowledge modules (auto-suggested via hooks)
├── hooks/           # Auto-activation hooks (skill-activation-prompt)
├── commands/        # Slash command workflows
└── settings.json    # Permissions + hooks registration
```

---

## Rules (Auto-loaded every conversation)

| File | Description |
|------|-------------|
| [project.md](.claude/rules/project.md) | Project overview, stack, conventions |
| [code-style.md](.claude/rules/code-style.md) | Code ordering, types, i18n, testing attributes |
| [codebase-map.md](.claude/rules/codebase-map.md) | Key file paths for quick navigation |

---

## Skills (Auto-suggested via hooks when relevant)

| Skill | Trigger Keywords | Description |
|-------|-----------------|-------------|
| `page-patterns` | page, list, layout, loading, search, bottom button | Page development patterns, style constants, loading/search patterns |
| `ui-conventions` | header, button, icon, animation, toast, i18n | Header actions, buttons, icons, animations, i18n, toasts |
| `data-layer` | repository, supabase, indexeddb, migration, dexie | Repository usage, Supabase/IndexedDB, database migrations |
| `quiz-maintainer` | quiz, practice, flashcard, SRS, badge, mastered | Quiz UI, practice mode, SRS, flashcards, badge counts |
| `testing` | test, vitest, playwright, E2E, mock | Unit tests, E2E, mocking repository/i18n/auth, test IDs |

---

## Commands

| Command | Description |
|---------|-------------|
| `/backfill-ko` | Translate dictionary entries (English→Korean) using Sonnet |

---

## File Reading Strategy (Auto-Context Loading)

### Default Behavior: Read Related Files Automatically

When user mentions a file for modification, **automatically read related files** for context:

**Read Order:**
1. **Target file** (user-specified)
2. **Imported modules** (components, hooks, utils referenced by the target)
3. **Repository/store** (if target uses `useRepository()` or auth store)
4. **Type definitions** (if target uses project types from `@/types/`)
5. **Style constants** (if target uses `@/lib/styles`)

**Limits:**
- Maximum 5 related files to avoid token overuse
- Skip if file is too large (>1000 lines)
- Stop if already have sufficient context

**Report what was read:**
```
"Read files: word-card.tsx, types/word.ts, lib/styles.ts"
```

### Exception: Read Only Target File

If user explicitly says "only this file", "just this file", "이 파일만", or path ends with "만 읽어줘" — read ONLY the specified file.

### When to Skip Auto-Read

- User asks a simple question ("뭐가 있어?", "확인해줘")
- User uses "만" keyword ("only", "just")
- Reading for reference, not modification

---

## Plan Mode Documentation Rules

**Required**: Plan documents must be saved in `_docs/`

### Document Lifecycle

```
Plan → _docs/ save → Spec/Checklist → Implementation → User Feedback → _docs rewrite → Complete
```

| Status | Meaning |
|--------|---------|
| Planning | Plan drafted, not yet approved |
| In Progress | Implementation started |
| Feedback | Waiting for user review |
| Complete | Verified and docs finalized |

### Plan Document Template

```markdown
# Feature Name

> Status: Planning | In Progress | Feedback | Complete

## Spec
- Requirements and design decisions

## Checklist
- [ ] Task 1
- [ ] Task 2

## Implementation Notes
(Decisions and changes during implementation)

## User Feedback
(Feedback records)

## Final Summary
(Post-completion rewrite — final result, lessons learned)
```

**Always update** `_docs/` index when creating new docs.
