## Why

The "not a project" suggestion rule looks for skills folders only at `~/.agents/skills` and `~/.claude/skills`. A user who moved Claude Code's folder with the `claudeConfigDir` setting or `CLAUDE_CONFIG_DIR` keeps skills in `<that folder>/skills`. Sessions recorded there get no Ignore proposal, and can get a wrong name-based map.

## What Changes

- The skills folder check uses Claude Code's folder from the same lookup as the rest of OMMS: the `claudeConfigDir` setting, then `CLAUDE_CONFIG_DIR`, then `~/.claude`.
- `~/.agents/skills` stays a skills folder.
- Nothing else changes. Users of the default `~/.claude` see no difference.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `import-directory-maps`: the not-a-project rule follows the configured Claude Code folder for its skills folder.

## Impact

- `src/importer/map-suggestions.ts` (rule 1 and `directoryMapsView`), using `resolveClaudeFolder` from `src/services/claude-folder.ts`.
- `tests/map-suggestions.test.ts`.
- `docs/web-ui-settings.md` (Suggestions list).
