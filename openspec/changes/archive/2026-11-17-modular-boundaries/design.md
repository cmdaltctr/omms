# Design: modular-boundaries

## Context

See proposal.md, Why. This section gives the measured state of the code at `8da0072f` and the method behind each number.

### Method

- Import edges: `ast-grep scan` with a rule that matches the string inside an `import` or `export` statement, or inside the arguments of an `import()` call. It found 2,156 specifiers in `src/`. Relative specifiers were resolved to `src/`-relative `.ts` paths.
- Host comparisons: `ast-grep scan` with a rule that matches a string literal `"pi"`, `"opencode"`, `"claude-code"` or `"claude"` inside a `binary_expression` or a `switch_case`.
- Raw SQL: `scanLiterals` from `tests/memory-sql-scan.ts` (it skips comments), then a case-sensitive match for a statement start: `SELECT`, `INSERT [OR x] INTO`, `UPDATE x SET`, `DELETE FROM`, `CREATE TABLE|INDEX|UNIQUE|VIRTUAL|TRIGGER`, `ALTER TABLE`, `DROP TABLE|INDEX`, `PRAGMA`, `WITH x`, `BEGIN`, `COMMIT`, `ROLLBACK`, `VACUUM`. A case-insensitive match gave false hits such as "replace the placeholder" and "Delete turns failed".

### Measured numbers, and how they compare with the audit

| Measure                                                                                                      | Real number                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Audit said        | Note                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Host-name comparisons outside `src/adapters/`                                                                | 36 lines in 13 files (30 lines in 10 importer files, 6 lines in 3 services files)                                                                                                                                                                                                                                                                                                                                                                                                   | 36 in 13          | Confirmed. `src/v2/`, `src/plugin.ts`, `src/cli/`, `src/types/`, `src/utils/`, `src/shared/`, `src/config.ts`: 0      |
| Shared `src/` files that name a host id                                                                      | 35; 17 name all three                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 17 name all three | Confirmed                                                                                                             |
| Named host unions                                                                                            | `src/`: 4 (`types/index.ts:2`, `importer/import-args.ts:11`, `importer/backfill-model.ts:1`, `services/backfill-state.ts:7`) plus inline unions at `core/profile-backoff.ts:43`, `importer/map-suggestions.ts:446`, `services/capture-attempt-store.ts:84`, `services/web-server.ts:1112,1136,1384,1450,1464` and the list `services/host-appearance.ts:4`. `web/src/`: 3 (`lib/host-label.ts:1`, `lib/auto-import-settings.ts:1`, `components/memory/DirectoryMapsSection.tsx:26`) | 4 and 3           | Confirmed                                                                                                             |
| The same three-host check                                                                                    | `capture-retry-queue.ts:267`, `web-server.ts:1441`, `web-server.ts:1459`, `web-import-jobs.ts:111`, plus `import-sessions.ts:245` and `web-server.ts:1367`                                                                                                                                                                                                                                                                                                                          | 4                 | Understated by 2                                                                                                      |
| `CONFIG` imports in `src/core/` and `src/services/`                                                          | 52 files (5 core, 47 services), 63 import sites; 45 files import statically, 7 only through `import()`                                                                                                                                                                                                                                                                                                                                                                              | 46 files          | Understated. The audit left out some files; 5 of the 52 are in `services/turso/`                                      |
| Files outside `src/services/turso/` that import `turso/*` or `@libsql/client`                                | 51 files, 137 import sites (50 import `turso/*`, 6 import `@libsql/client`, 5 do both)                                                                                                                                                                                                                                                                                                                                                                                              | 50 and 6          | Confirmed                                                                                                             |
| Files outside `src/services/turso/` with raw SQL literals                                                    | 50 (8 in `src/importer/`, 42 in `src/services/`)                                                                                                                                                                                                                                                                                                                                                                                                                                    | 13                | Understated. The audit counted only memory-store SQL; the ledger, skill, chat, prompt and profile stores also run SQL |
| `src/config.ts` imports of `src/importer/`                                                                   | 2 static (`:9` `backfill-model.ts`, `:10` `import-path-maps.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                    | 2                 | Confirmed. Both modules are light (no imports, or `node:os`/`node:path` and a type-only import)                       |
| `@opencode/*` imports                                                                                        | 9 files, all type-only, all in `src/v2/`, `src/plugin.ts` or `src/adapters/opencode/`                                                                                                                                                                                                                                                                                                                                                                                               | n/a               | No violation today                                                                                                    |
| Adapter pair crossings (6 pairs), shared code into `src/v2/` or `src/plugin.ts`, `src/shared/` out of itself | 0, 0, 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0                 | Confirmed                                                                                                             |
| SDK pattern gap                                                                                              | `tests/pi-adapter-boundary.test.ts:14` and `tests/claude-code-adapter-boundary.test.ts:10` use `@(opencode-ai\|earendil-works)/`                                                                                                                                                                                                                                                                                                                                                    | same              | Confirmed. `package-dependencies.test.ts:55-62` catches only non-type `from` lines                                    |
| Web edit without the write lock                                                                              | `services/api-handlers.ts:441-516` (`handleUpdateMemory`) deletes and inserts in a transaction with no `withScopeWriteLock`; `client.ts:253` and `api-handlers.ts:354` take it                                                                                                                                                                                                                                                                                                      | 479-500           | Confirmed                                                                                                             |
| File-size baseline                                                                                           | 15 files in `tests/file-size-ceiling.test.ts:12-28`; `AGENTS.md:147` says 19                                                                                                                                                                                                                                                                                                                                                                                                        | 15                | Confirmed; docs stale                                                                                                 |
| Web host comparisons                                                                                         | 12 in 6 files; 5 non-translation files list all three hosts                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a               | Out of scope (see proposal)                                                                                           |

### Constraints

- `src/core/` and `src/services/` must not import adapters or `src/importer/` (one exception: 5 dynamic imports in `web-server.ts`).
- 24 test files replace `src/config.js` with a partial stub through `mock.module`. A new export from `config.ts` is missing in those stubs.
- `web/src/` reaches `src/` only through the `$shared` alias (`src/shared/`), set in `web/vite.config.ts` and `web/tsconfig.app.json`.
- The web app runs on its own, with no adapter loaded. Claude Code has no in-process adapter at all: its hooks call the web app.
- Keep each file at 500 lines or fewer, and do not grow a file in the size baseline.
- Three parallel changes edit `web/src/`, `src/services/web-server.ts` and `src/config.ts`. Keep edits there small.

## Goals / Non-Goals

**Goals:**

- One list of hosts, one type, one guard, and one compiler-checked entry per host in each layer that needs host facts.
- No host-name comparison and no host list in shared `src/` code outside the registry.
- A test for every written boundary rule, and a ratchet for each known debt.
- `src/config.ts` loads no importer code.
- The web memory edit takes the scope write lock.
- No user-visible behaviour change.

**Non-Goals:**

- The storage port, config injection, the OpenCode profile-learning move, and god-module splits (proposal, Follow-up changes).
- Host lists inside `web/src/` components.
- Renaming the `ImportHost`, `BackfillHost` and `WebHost` names across their users.

## Decisions

### 1. The registry has two parts, split by layer, keyed by one type

| File                             | Holds                                                                                                                                                        | Imports                                                                                                                         | Who imports it                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `src/shared/hosts.ts`            | `HOSTS = ["pi", "opencode", "claude-code"] as const`, `type MemoryHost`, `isMemoryHost(value)`, `HOST_INFO: Record<MemoryHost, HostInfo>`, `hostLabel(host)` | nothing                                                                                                                         | every layer, and `web/src/` through `$shared/hosts` |
| `src/importer/host-importers.ts` | `HOST_IMPORTERS: Record<MemoryHost, HostImporter>` and `ImportSourceKind`                                                                                    | readers only through `import()`; constants from `discovery.ts` and `opencode-reader.ts`; types only from other importer modules | importer modules only                               |

`HostInfo` fields: `label`, `article` (`"A"` or `"An"`, for "An OpenCode import is already running"), `commandName` (`opencode`, `pi`, `claude`), `sessionModel` (the host can lend its session model), `sessionCommands` (the host has in-session slash commands), `backfillModelKey` (`"piBackfillModel"`, `"opencodeBackfillModel"` or `null`), and `sourceOption` (`--root` or `--db` and its usage line).

`HostImporter` fields: `defaultSourcePath(claudeConfigDir?)`, `browseStart(claudeConfigDir?)`, `sourceKind(realPath, stats)` (a kind or an error message), `browseFileKind(name)`, `listSessions(...)` (raw rows, reader loaded lazily), `runImport(...)` (importer loaded lazily), `readerBlocked(readiness)`, and `worktreeHints` (true for OpenCode only).

Reasons:

- The host list, labels and flags are plain data. Putting them in `src/shared/` lets the web use the same list through `$shared`, which it cannot do with any other folder.
- The history parts need `node:fs` and the readers. They belong in `src/importer/`, where CLAUDE.md puts each host's reader. Core and services must not import the importer, and they need none of these parts.
- `HOST_IMPORTERS` functions return data or a message. They never import `import-sources.ts`, `import-sessions.ts` or `run-import.ts` at run time, so there is no import cycle.
- Neither file imports `CONFIG`. Callers pass `claudeConfigDir` or config values. The `mock.module` stubs of `config.js` keep working because the registry never reaches config.
- `src/types/index.ts` keeps `MemoryHost` as `export type { MemoryHost } from "../shared/hosts.js"`, so its 18 importers do not change. `ImportHost`, `BackfillHost` and the web `WebHost` stay as aliases of `MemoryHost` (one line each) so their 12, 13 and 23 users do not change. `src/types/host-label.ts` is deleted; its 5 callers import `hostLabel` from `src/shared/hosts.ts`.

Alternative rejected: adapters register their host at start-up, like `registerHostProfileModel`. The web app runs with no adapter loaded and serves all three hosts, and Claude Code has no in-process adapter. A runtime registry would be empty there.

### 2. How hosts register, against `docs/shared-core.md`

Hosts do not register at run time. Each host is a static entry in the two registry files. This keeps the import direction in `docs/shared-core.md`: adapters import shared code; shared code never imports an adapter. The runtime registrations that exist today (`registerHostProfileModel`, `registerOpencodeHostModels`, `registerHostBackfillModels`) stay. They carry host model access, which needs a running host, not host identity. `docs/shared-core.md` gets a "Host registry" section and new steps in "Add a new host adapter".

### 3. Each host branch becomes a registry look-up

| Site                                                                                                                      | Today                                                                               | After                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `importer/backfill-model.ts:10-11`                                                                                        | `host === "claude-code"`, `host === "pi" ? piBackfillModel : opencodeBackfillModel` | moved to `src/utils/backfill-model.ts`; reads `HOST_INFO[host].backfillModelKey` (null means `"external"`)                                                             |
| `importer/backfill-controls.ts:64`                                                                                        | Pi or OpenCode live rule                                                            | `liveModelUsesExternal(host, CONFIG)` in `live-model-choice.ts`                                                                                                        |
| `importer/backfill-controls.ts:72`                                                                                        | `host === "claude-code"`                                                            | `!HOST_INFO[host].sessionModel`                                                                                                                                        |
| `importer/backfill-controls.ts:119`, `run-import.ts:60`                                                                   | `host === "opencode" ? "An" : "A"`                                                  | `HOST_INFO[host].article`                                                                                                                                              |
| `importer/backfill-controls.ts` `status()`                                                                                | object with three keys                                                              | built from `HOSTS` (same key order)                                                                                                                                    |
| `importer/import-args.ts:280-289`                                                                                         | command name, session surface, source usage line                                    | `commandName`, `sessionCommands`, `sourceOption`                                                                                                                       |
| `importer/import-readiness.ts:126`                                                                                        | Pi reader check                                                                     | `HOST_IMPORTERS[host].readerBlocked(readiness)`                                                                                                                        |
| `importer/import-readiness.ts:130`, `web-import-jobs.ts:160,166`, `record-past-turns.ts:63`                               | `host === "claude-code"` (external API only)                                        | `!HOST_INFO[host].sessionModel`                                                                                                                                        |
| `importer/import-sessions.ts:91,100` and the OpenCode tail                                                                | reader per host                                                                     | `HOST_IMPORTERS[host].listSessions(...)`; `import-sessions.ts` keeps `resolveImportProject`                                                                            |
| `importer/import-sessions.ts:245`, `web-import-jobs.ts:111`, `capture-retry-queue.ts:267`, `web-server.ts:1367,1441,1459` | three-host check                                                                    | `isMemoryHost(value)`                                                                                                                                                  |
| `importer/import-sources.ts:120-121,136,144,177,189,191`                                                                  | default path, source kind, browse start, browse filter                              | `defaultSourcePath`, `sourceKind`, `browseStart`, `browseFileKind`                                                                                                     |
| `importer/map-suggestions.ts:454`                                                                                         | OpenCode worktree hint                                                              | `HOST_IMPORTERS[name].worktreeHints`                                                                                                                                   |
| `importer/record-past-turns.ts:17,22`, `web-import-jobs.ts:104`                                                           | host lists, Pi reader check                                                         | `HOSTS`, `readerBlocked`                                                                                                                                               |
| `importer/run-import.ts:188,253`                                                                                          | import function per host                                                            | `HOST_IMPORTERS[host].runImport(...)`; `run-import.ts` keeps the shared `deps` and `filters`                                                                           |
| `services/web-server.ts:1349-1350`                                                                                        | Settings model list per host                                                        | `isMemoryHost` and `HOST_INFO[host].sessionModel`, then `listSettingsModels(host)` in `settings-models.ts`; same 400 "Invalid host" for Claude Code and unknown values |
| `services/web-server.ts` route patterns `(pi\|opencode\|claude-code)` and the status object                               | literal lists                                                                       | built from `HOSTS` (same key order)                                                                                                                                    |
| `services/ai/live-model-choice.ts:103`                                                                                    | `status.mode === "opencode"`                                                        | unchanged. It compares a provider mode, and CLAUDE.md makes this file the one place for the live-model rule. The file is on the test's allow list                      |

Where a value differs by host and is not a flag, put it in a registry entry: `HostInfo`, `HostImporter` (for example the Settings model list), or the `LIVE_MODELS` table in `live-model-choice.ts` (the live-model status for `effective` and whether it picks the external API). The compiler then names the missing entry.

Per-host objects and messages are built from the registry, not written out per host: the import-run rows (bound as SQL parameters), the source flags, `defaultSourceFound`, `lastLiveSaves`, the directory-map view, the retry counts, `effective`, and the host lists in messages (`hostChoiceMessage()`, `hostLabelList()`).

Order: `HOSTS` uses `pi, opencode, claude-code`, the order of most API objects. Objects built from `HOSTS` keep their key order. Two objects had another order, and a characterisation test in `web-settings-api.test.ts` pins both: the retry counts (`opencode, pi, claude-code`) keep OpenCode as a first literal key and then add every host from `HOSTS`; `effective` (`opencode, pi, claude-code`) follows the key order of the `LIVE_MODELS` table.

### 4. Boundary tests share one import scanner

`tests/source-imports.ts` exports the specifier regex and `localImports` from `tests/claude-code-adapter-boundary.test.ts` (it covers `from`, bare `import`, `import()` and `require()`), a `crossings(fromAreas, forbiddenAreas)` helper, and `HOST_SDK_SPECIFIER = /["'`]@(opencode|opencode-ai|earendil-works)\//`. The two existing tests import the pattern from it, so no copy stays on the old pattern.

`tests/module-boundaries.test.ts` checks:

- No file in `src/core/`, `src/services/`, `src/types/`, `src/utils/`, `src/shared/`, `src/importer/` or `src/config.ts` names `@opencode/*` (the importer keeps its Pi reader exception from `pi-adapter-boundary`).
- For each pair of folders under `src/adapters/`, read from the folder list at run time, no file of one imports the other. `src/v2/` and `src/plugin.ts` count as part of the OpenCode host.
- No file outside `src/v2/`, `src/plugin.ts` and `src/adapters/opencode/` imports `src/v2/*` or `src/plugin.ts`.
- No file in `src/utils/` or `src/config.ts` imports `src/adapters/*`, `src/v2/*` or `src/plugin.ts`.
- `src/shared/` imports only `src/shared/` files and packages.
- A scanner guard, like `file-size-ceiling.test.ts`: the scan finds the known `cli/index.ts` lazy import, so an empty scan cannot pass.

The `src/config.ts` check lives with group 4, because it fails until that group lands.

### 5. The host-name test reads the TypeScript syntax tree

`tests/host-branch-boundary.test.ts` parses each `src/` file with the `typescript` package (already a dev dependency) and fails on:

- a `===`, `!==`, `==` or `!=` with a host-id string on either side;
- a `case` clause with a host-id string;
- two or more host-id strings in one array literal, one union type, one regex literal, the elements of a `new Set([...])`, or the keys of a `new Map([...])`.

The host ids are `pi`, `opencode`, `claude-code` and `claude` (Claude Code's command name).

Allowed: `src/adapters/**`, `src/v2/**`, `src/plugin.ts`, `src/shared/hosts.ts`, `src/importer/host-importers.ts`, `src/services/ai/live-model-choice.ts`. The baseline is empty: the test fails today with 39 lines in 13 files (35 lines that compare or switch on a host id, and 4 that list two or more hosts in an array; the ast-grep count of 36 above uses a different method) and passes after groups 4 and 5. A syntax-tree scan ignores comments and text, so prose such as "opencode" in a message does not count.

### 6. Ratchets follow the file-size test

`tests/modularity-ratchets.test.ts` holds three baselines as `Record<path, number>`:

| Ratchet          | Scope                                   | Counts                                                                                 | Baseline                    |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| `CONFIG` imports | `src/core/`, `src/services/`            | non-type import sites that resolve to `src/config.ts`                                  | 52 files                    |
| Storage imports  | all `src/` except `src/services/turso/` | import sites of `@libsql/client*` or a `src/services/turso/*` file, type-only included | 51 files                    |
| Raw SQL          | all `src/` except `src/services/turso/` | SQL literals by the method above                                                       | 50 files (49 after group 6) |

Each ratchet has five checks: the scan finds more than a set minimum (guard); a file not in the baseline has a count of 0; a listed file's count is not above its baseline; a listed file below its baseline fails with "lower the baseline to N"; a listed file with a count of 0 fails as stale until its entry is deleted. A separate check fails when a file other than `src/config.ts` re-exports `CONFIG`, so a re-export cannot hide an import from the `CONFIG` ratchet. The storage folder is one constant, so the storage-port follow-up changes one line. The raw-SQL scan reuses `scanLiterals`; it needs no new parser.

Record each baseline after groups 3 to 6 land (task 7.2), because those groups lower some counts (for example `api-handlers.ts` SQL).

### 7. `src/config.ts` stops importing the importer

- `parseBackfillModel` and `BackfillModel` move to `src/utils/backfill-model.ts`. It imports only `src/shared/hosts.ts`. `src/importer/backfill-model.ts` is deleted; its users import `MemoryHost` and the parser from the new paths.
- `parseImportPathMaps` and `parseIgnoredDirectories` move to `src/utils/import-path-config.ts`. `mergeImportPathMaps` and `runPathMaps` stay in `src/importer/import-path-maps.ts`.
- `config.ts:515-516` validates the backfill model with `for (const host of HOSTS) parseBackfillModel(fileConfig, host)`. Claude Code returns `"external"` without reading, as today.
- No re-export shims. The three tests that import the old paths change their import line only.

### 8. The web edit takes the scope write lock

`handleUpdateMemory` keeps its read and its embedding outside the lock, as `client.ts` does. It then calls `tursoShardManager.withScopeWriteLock(scope, hash, ...)` with the scope from `extractScopeFromContainerTag(existing.container_tag)`, and inside the lock calls `replaceMemoryRow(record)`, built from the existing row and the edit. This removes the copied `DELETE` and `INSERT` SQL from `api-handlers.ts`. When `replaceMemoryRow` returns false (the row went away between read and lock), the handler returns "Memory not found".

Score: likelihood 2 (a web edit while a capture or import writes the same scope from another process), impact 2 (a busy error or an out-of-order write on one row; the transaction stops a partial write). 4, so fix now.

Regression test: hold the scope lock with a callback that waits on a promise, start `handleUpdateMemory`, and check that the stored row is unchanged until the lock is released. On the current code the row changes while the lock is held, so the test fails.

### 9. Host coverage

| Host        | Effect                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode    | Import commands, backfill, Settings model list and Health read the same answers through the registry. `src/v2/` and `src/adapters/opencode/` do not change except the `parseBackfillModel` import path in `backfill-models.ts`. |
| Pi          | Same as OpenCode. `src/adapters/pi/backfill-models.ts` changes its import path only.                                                                                                                                            |
| Claude Code | Imports, backfill and readiness keep "external API only" through `sessionModel: false`. The hook client does not change. Web edits now take the lock for every host, since the web app serves all three.                        |

### 10. Proof that behaviour does not change

- Before group 3, run the focused tests of every file it touches and record each pass (task 3.1).
- Add characterisation cases where a branch has none: `historyImportUsage` for each host and surface, `ImportAlreadyRunningError` and the Run-now refusal text per host, `importBlockedReason` per host, the Settings model list for each host value, and `parseBackfillModel` per host. They pass on the current code and must pass unchanged after.
- No existing assertion is removed or weakened. Only import lines and the SDK pattern change in existing tests.
- `bun run ci:local` passes. `bun run check:package` passes, since `src/shared/hosts.ts` adds a file to `dist/`.

## Risks / Trade-offs

- [The registry spreads over two files] → Both are keyed by `MemoryHost`, so a missing entry is a compile error. ADR 050 records why.
- [A fourth host still edits shared files] → Measured by adding a fake id to `HOSTS` and running the type-checker: a fourth host edits 4 shared `src/` files. The compiler names `src/shared/hosts.ts`, `src/importer/host-importers.ts` and `src/services/ai/live-model-choice.ts`. `src/cli/index.ts` needs a hand edit of its help text and "Expected ..." message, which list OpenCode first, so building them from `HOSTS` would change the output. A host that lends its session model also edits `config.ts`, `config-template.ts`, the `backfillModelKey` type in `hosts.ts`, and the model check in `import-readiness.ts`. The web is not reduced by this change (the compiler names 9 web files). Before: 21 shared `src/` files.
- [Parallel changes conflict] → `web-server.ts`, `config.ts` and the three web files get small local edits. `simpler-import` and `friendly-settings` may add host checks in web components; this change does not test `web/src/`, so it does not block them.
- [Ratchet baselines go stale at merge] → Another branch that adds a `CONFIG` import, a storage import or SQL in a shared file fails the ratchet after rebase. That is the point; the fix is to use an existing path or pass config in.
- [The SQL scan misses lower-case or concatenated SQL] → A ratchet only needs to stop growth of the common form. The method and its limit go in the test comment.
- [Moving `listSessions` and `runImport` behind the registry adds an `import()`] → The readers were already loaded lazily, except Pi discovery; one extra dynamic import per listing is not measurable next to a file walk.

## Migration Plan

No data or config migration. Rollback is a revert of the pull request.

## Open Questions

None.
