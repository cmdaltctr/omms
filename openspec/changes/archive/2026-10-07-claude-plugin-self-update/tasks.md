## 1. Claude plugin self-update

- [x] 1.1 Add tests for start, current, retry window, a newer release after an earlier one, check off, no plugin root, npm offline, prerelease, and a failed start.
- [x] 1.2 Add `src/adapters/claude-code/plugin-self-update.ts` and call it after the session-start hook in `hook-command.ts`.
- [x] 1.3 Remove `CLAUDE_PLUGIN_ROOT` in `tests/preload.ts`; run the hook tests with it set.
- [x] 1.4 Run the built hook in a temporary home with an older plugin; confirm the marker, one log record, and no second start.
- [x] 1.5 Update `docs/claude-code-adapter.md`.
- [x] 1.6 Run `bun run ci:local`.
