## Context

Rule 1 of the suggestion engine in `src/importer/map-suggestions.ts` proposes Ignore for skills folders. It names `~/.claude/skills` directly. `resolveClaudeFolder` in `src/services/claude-folder.ts` already gives Claude Code's folder for every other caller: the `claudeConfigDir` setting, then `CLAUDE_CONFIG_DIR`, then `~/.claude`.

## Goals / Non-Goals

**Goals:** the skills folder check follows Claude Code's configured folder.

**Non-Goals:** other skills locations, or any change to rules 2 to 6.

## Decisions

- `MapSuggestionContext` gets an optional `claudeFolder`. `directoryMapsView` passes `resolveClaudeFolder(CONFIG.claudeConfigDir).folder`. Without it, rule 1 uses `<home>/.claude`, so the pure function stays testable without `CONFIG`.
- `resolveClaudeFolder` is pure and already used by the settings snapshot, so no new lookup is written.

## Risks / Trade-offs

- [A `CLAUDE_CONFIG_DIR` set only in a shell is not seen by the login-item web app] → Same limit as the rest of OMMS. The `claudeConfigDir` setting covers it.
