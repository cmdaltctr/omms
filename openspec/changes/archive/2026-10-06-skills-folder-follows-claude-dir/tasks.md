## 1. Skills folder follows Claude Code's folder

- [x] 1.1 Write a failing test in `tests/map-suggestions.test.ts`: with `claudeFolder` set to `<home>/.claude-work`, a missing folder in `<home>/.claude-work/skills` gets an Ignore proposal with the skills reason, and `<home>/.claude/skills` still does by default.
- [x] 1.2 Add `claudeFolder` to `MapSuggestionContext`, use it in rule 1, and pass `resolveClaudeFolder(CONFIG.claudeConfigDir).folder` from `directoryMapsView`.
- [x] 1.3 Update the Suggestions list in `docs/web-ui-settings.md`. Run the focused tests and `openspec validate skills-folder-follows-claude-dir --strict`.
