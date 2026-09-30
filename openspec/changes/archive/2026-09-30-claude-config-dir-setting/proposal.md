# Proposal

## Why

Claude Code keeps its transcripts in `$CLAUDE_CONFIG_DIR/projects` when that variable is set. The web app reads the variable from its own environment only. A web app started by a login item, or by hand, does not have it. With a custom Claude folder, every live capture gets `400` and the web import screens look in the wrong folder. People should not have to set environment variables for the web app. The folder must be a plain field on the Settings page.

PR #53 made the capture route and the terminal importer follow `CLAUDE_CONFIG_DIR`. It missed the web import readiness and session list, which use a second copy of the default folder in `src/importer/import-sources.ts`. This change closes that gap too.

## What Changes

- Add a global config key `claudeConfigDir`. It is empty by default. A project config cannot set it.
- Resolve the Claude projects folder in one place. The order is: the `claudeConfigDir` key, then the `CLAUDE_CONFIG_DIR` environment variable, then `~/.claude`. The projects folder is `<that folder>/projects`.
- Use the one resolver in the capture route, the terminal importer, the automatic backfill, the web import readiness, the web session list, and the web folder picker. Remove the second copy of the default folder.
- Add a **Claude Code folder** section to the Settings page. It has a text field for `claudeConfigDir`. It shows the folder in use, where the folder came from, and a warning when the folder does not exist.
- Translate the new text into the languages the page already supports.
- Update the docs. Remove the note that says the web app needs the environment variable.

Pi and OpenCode are not affected. The setting is Claude Code specific, and the hook client needs no change because it only forwards the `transcript_path` that Claude Code gives it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-code-adapter`: The capture endpoint accepts only Claude Code transcripts, in the resolved folder. This rule shipped in PR #53 without a spec.
- `claude-code-history-import`: The reader, the terminal importer, and the web import surfaces use the resolved folder.
- `web-settings`: The Settings page has a Claude Code folder section.

## Impact

- Code: new `src/services/claude-folder.ts`, `src/config.ts`, `src/importer/claude-reader.ts`, `src/importer/import-sources.ts`, `src/importer/import-readiness.ts`, `src/importer/import-sessions.ts`, `src/importer/run-import.ts`, `src/importer/claude-hook-api.ts`, `src/services/settings-snapshot.ts`, `src/services/global-config-writer.ts`, `web/src/lib/components/settings/`, `web/src/lib/i18n/settings.ts`.
- Docs: `docs/web-ui-settings.md`, `docs/configuration.md`, `docs/claude-code-adapter.md`, `docs/claude-code-history-import.md`.
- No breaking change. With the key empty, the behaviour of PR #53 stays.
