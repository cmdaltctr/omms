# Design

## Context

See proposal.md for the reason. Today the Claude projects folder comes from two functions that do the same job:

- `defaultClaudeProjectsRoot()` in `src/importer/claude-reader.ts` reads `CLAUDE_CONFIG_DIR` (added in PR #53). The capture route and the terminal importer use it.
- `defaultClaudeSourcePath()` in `src/importer/import-sources.ts` returns `~/.claude/projects` only. The web import readiness and session list use it. It is a separate copy because `claude-reader.ts` loads the storage engine and the light module must not. `tests/import-sources.test.ts` checks that the two agree, but only with the variable unset.

Many tests replace `src/config.js` with a stub through `mock.module`. A new export from `src/config.ts` is missing in those stubs. New logic must be pure and take `CONFIG` as an argument.

## Goals / Non-Goals

**Goals**

- The user sets the Claude folder on the Settings page. No environment variable and no file editing.
- One resolver. Every caller gets the same folder.
- A change on the page applies to the next request without a restart.

**Non-Goals**

- No change for Pi or OpenCode.
- No change to the hook client. It forwards `transcript_path` and needs no folder.
- No auto-detection of the folder from running Claude Code processes.

## Decisions

1. **One small pure module, `src/services/claude-folder.ts`.** It imports only `node:path` and `node:os`. It has no import of the storage engine, `config.ts`, or the reader. It exports `resolveClaudeFolder(configured, env, home)` and `claudeProjectsRoot(...)`, and returns the folder with its source (`setting`, `env`, or `default`). An `undefined` or empty value counts as unset, so a test stub of `CONFIG` without the key keeps today's behaviour. Both old functions call it, and callers pass `CONFIG.claudeConfigDir`. Alternative: read `CONFIG` inside the module. Rejected, because tests stub `src/config.js` and would break.
   It lives in `src/services/`, not `src/importer/`, because `src/services/settings-snapshot.ts` (decision 6) needs it. `docs/shared-core.md` forbids `src/services/*` to import `src/importer/*`, and `tests/pi-adapter-boundary.test.ts` enforces that rule. The importer may import services, so every caller can reach it. Alternative: keep it in `src/importer/` and build the folder report in `web-server.ts` through a new dynamic import. Rejected: it widens the boundary exception list for one pure function.
2. **Delete the second copy.** `defaultClaudeSourcePath()` calls the shared module. The agreement test then covers the setting, the variable, and the default.
3. **Precedence: setting, then variable, then default.** The page is the plug-and-play path, so it wins. The variable stays for users who already set it. Alternative: variable first. Rejected: a user who fills in the field would see no effect and would not know why.
4. **The key is global only.** A checked-in project file must not point the web app at another folder. `src/config.ts` deletes it from project overrides, as it does for `importPathMaps`.
5. **Validation.** An absolute path, or `~/...` expanded to the home folder. Other values are rejected in `global-config-writer.ts` and in the config load. An empty string means unset. The writer today rejects an empty string for every text key, so it needs an explicit rule that accepts `""` for `claudeConfigDir`. That is how the page clears the field. Alternative: allow relative paths. Rejected: a relative path depends on the web app's working directory, which the user cannot see.
6. **The snapshot reports the folder.** `getSettingsSnapshot` adds `claudeFolder: { root, source, exists }`. The page shows it and warns when `exists` is false. The `exists` check uses `existsSync` only. It never reads transcript files.
7. **New page component.** `ClaudeFolderSection.tsx` follows `WebAppSection.tsx`: read `/api/settings`, save with `PATCH` and the revision. It is a separate component so `ModelsSection.tsx` does not grow.
8. **Live change.** The capture route and the readiness check call the resolver on each request with the current `CONFIG`. `refreshConfigIfChanged` already runs on the settings routes. The capture route also calls it before the path check, so a hand edit of the global file applies too. Task 4.2 checks that the capture route sees a saved change without a restart.
9. **Where each caller gets the setting.** Modules that already import `CONFIG` read `CONFIG.claudeConfigDir` and pass it on: `claude-hook-api.ts`, `import-readiness.ts`, and `import-sessions.ts` (add the import). `import-sources.ts` stays light: `defaultClaudeSourcePath(configured?)` and `defaultImportSourcePath(host, claudeConfigDir?)` take the value as an argument. `browseImportSources` uses it too, so the folder picker opens in the right folder. The terminal importer and automatic backfill both run `runHistoryImport` in `src/importer/run-import.ts`. Its Claude Code branch sets `root` from the resolver when `args.source` is absent, with `CONFIG` loaded by dynamic `import("../config.js")`. The import report then names the real folder.

## Risks / Trade-offs

- A saved folder that is wrong makes every capture return `400`. The page warning about a missing folder reduces this. A folder that exists but is not Claude's still passes. Accepted.
- The path check needs the folder on disk. A folder on a network drive that is offline reads as missing. Accepted.
- Users who set both the field and the variable get the field. The page shows the source, so the result is visible.

## Migration Plan

No migration. The key is new and empty by default. Existing setups keep the behaviour from PR #53.

## Open Questions

None.
