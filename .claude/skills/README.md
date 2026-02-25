# Skills

On-demand knowledge modules, auto-suggested via hooks when relevant context is detected.

## Skill Catalog

| Skill | Type | Trigger Keywords | Description |
|-------|------|-----------------|-------------|
| [page-patterns](page-patterns/SKILL.md) | domain | page, list, layout, loading, search | Page development patterns, style constants, loading/search |
| [ui-conventions](ui-conventions/SKILL.md) | domain | header, button, icon, animation, toast | Header actions, buttons, icons, animations, i18n, toasts |
| [data-layer](data-layer/SKILL.md) | domain | repository, supabase, indexeddb, migration | Repository usage, Supabase/IndexedDB, migrations |
| [quiz-maintainer](quiz-maintainer/SKILL.md) | domain | quiz, practice, flashcard, SRS, badge | Quiz UI, practice mode, SRS, flashcards, badge counts |
| [testing](testing/SKILL.md) | domain | test, vitest, playwright, E2E | Unit tests, E2E, mocking, test IDs |

## How Auto-Activation Works

1. User types a prompt (e.g., "quiz 페이지 수정해줘")
2. `UserPromptSubmit` hook runs `skill-activation-prompt.sh`
3. Hook reads [skill-rules.json](skill-rules.json) and matches keywords/intent patterns
4. Matching skills are suggested to Claude as context
5. Claude can use the skill for guidance

### Manual Invocation

Skills can also be invoked manually via the Skill tool:
```
Skill("page-patterns")
Skill("ui-conventions")
Skill("data-layer")
Skill("quiz-maintainer")
Skill("testing")
```

## Configuration

- **Trigger rules**: [skill-rules.json](skill-rules.json)
- **Hook script**: `hooks/skill-activation-prompt.sh` → `hooks/skill-activation-prompt.ts`
- **Hook registration**: `settings.json` → `hooks.UserPromptSubmit`

## Adding New Skills

1. Create `.claude/skills/{skill-name}/SKILL.md` with YAML frontmatter
2. Add trigger entry to `skill-rules.json`
3. Test: `echo '{"prompt":"your test"}' | npx tsx .claude/hooks/skill-activation-prompt.ts`
4. Keep SKILL.md under 500 lines; use `resources/` for detailed content
