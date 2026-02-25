# Hooks

Claude Code hooks for skill auto-activation.

## Installed Hooks

### skill-activation-prompt (UserPromptSubmit)
- **Purpose**: Automatically suggests relevant skills based on user prompt keywords
- **How it works**: Reads `skill-rules.json`, matches keywords/intent patterns, injects skill suggestions
- **Customization**: Edit `.claude/skills/skill-rules.json` to adjust triggers

## Setup

Hooks are registered in `.claude/settings.json` under the `hooks` section.

### Dependencies
```bash
cd .claude/hooks && npm install
```

### Permissions (Unix/Mac)
```bash
chmod +x .claude/hooks/*.sh
```

## Adding New Skills to Auto-Activation

1. Create skill in `.claude/skills/{name}/SKILL.md`
2. Add entry to `.claude/skills/skill-rules.json`
3. Test: ask a prompt matching the keywords

## Troubleshooting

### Skill not suggesting
- Check `skill-rules.json` has the skill entry
- Check keywords match your prompt (case-insensitive)
- Manually test: `echo '{"prompt":"your test"}' | npx tsx skill-activation-prompt.ts`

### Hook not running
- Check `.claude/settings.json` has UserPromptSubmit hook registered
- Check `npm install` was run in `.claude/hooks/`
- On Unix: check `chmod +x` on `.sh` files
