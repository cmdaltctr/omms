# Proposal: modular-boundaries

## Why

OMMS claims one shared engine with thin host adapters. The host edge holds: no shared module imports an adapter or a host SDK, and no adapter imports another. Three other areas do not hold, and nothing stops them from getting worse:

- Host identity is spread over shared code. 39 lines in 13 files outside `src/adapters/` compare a value with a host name. There are 4 named host unions in `src/` and 3 in `web/src/`. A fourth host means edits in about 21 shared `src/` files. After this change it edits 4.
- 52 files in `src/core/` and `src/services/` import the global `CONFIG`. CLAUDE.md says they must take config as an argument.
- 51 files outside `src/services/turso/` import the storage engine, and 50 run raw SQL. There is no storage port.

Some written rules have no test. The test pattern for host SDKs, `@(opencode-ai|earendil-works)/`, misses the real OpenCode package `@opencode/plugin`. Nothing checks that the OpenCode and Pi adapters stay apart, or that shared code stays out of `src/v2/` and `src/plugin.ts`. `src/config.ts` imports two `src/importer/` modules, so every core and services file loads importer code through config. The web memory edit (`handleUpdateMemory`) deletes and inserts a row without the scope write lock that every other write takes.

CLAUDE.md asks for the host registry to be its own OpenSpec change. This is that change.

## What Changes

- Add one host registry. `src/shared/hosts.ts` holds the host list, the `MemoryHost` type derived from it, an `isMemoryHost` guard, and one identity entry per host (label, article, command name, session model, session commands, backfill-model key, source option). `src/importer/host-importers.ts` holds one history entry per host (default source, source check, browse filter, session discovery, import run, reader readiness). Both are keyed by `MemoryHost`, so the compiler names a missing entry.
- Replace the 39 host-name comparisons outside the adapters with registry look-ups. Replace the duplicate host unions in `src/` and the three named unions in `web/src/` with `MemoryHost`.
- Add boundary tests for rules that have none:
  - the host SDK pattern matches `@opencode/*` as well, for type-only and dynamic imports;
  - no adapter imports another adapter, for every pair;
  - shared code does not import `src/v2/` or `src/plugin.ts`;
  - `src/shared/` imports nothing outside itself;
  - `src/config.ts` imports nothing from `src/importer/`;
  - `src/utils/` and `src/config.ts` import no adapter, `src/v2/` or `src/plugin.ts`;
  - no host-name comparison or host list outside the adapters and the registry: equality checks, `case` clauses, arrays, union types, regex literals, `Set` and `Map` keys.
- Add ratchet tests with a baseline that may shrink and never grow, in the style of `tests/file-size-ceiling.test.ts`:
  - `CONFIG` imports in `src/core/` and `src/services/` (52 files);
  - `@libsql/client` and `src/services/turso/*` imports outside `src/services/turso/` (51 files);
  - raw SQL string literals outside `src/services/turso/` (50 files, counted per file);
  - a file that shrinks must get its new count, and no file but `src/config.ts` may re-export `CONFIG`.
- Build the per-host objects, the import-run rows and the host messages from the registry, so a fourth host edits 4 shared `src/` files: `src/shared/hosts.ts`, `src/importer/host-importers.ts`, `src/services/ai/live-model-choice.ts`, and the help text in `src/cli/index.ts`.
- Move the two config parsers that `src/config.ts` takes from the importer (`parseBackfillModel`, `parseImportPathMaps`, `parseIgnoredDirectories`) to `src/utils/`.
- Fix the web memory edit: take `withScopeWriteLock` for the memory's scope and replace the row through `replaceMemoryRow`, the same path as `client.ts`. Add a regression test that fails on the current code. Bug score: likelihood 2 × impact 2 = 4.
- Docs: correct the stale counts in `AGENTS.md` (host branches, file-size baseline), update `docs/shared-core.md` (registry, `src/shared/`, ratchets, new-host steps), add ADR 050 for the registry and the ratchets, add TDR 081 for the write-lock fix, and add both to their indexes.

No user-visible behaviour changes. Every API response, error text, CLI usage text and web screen stays the same. Nothing here is breaking.

## Out of scope

- Host lists and host comparisons inside `web/src/` components (12 comparisons in 6 files, 5 files that list every host). The parallel changes `simpler-import` and `friendly-settings` own most of those files. This change only replaces the three named web unions.
- The follow-up changes below.
- A web or `client.ts` memory edit resets `is_pinned` to 0. The bug is already on `origin/main` (`memory-replace.ts` and `vector-writes.ts` skip the column). Its own change fixes it.

## Follow-up changes

Each follow-up has a ratchet from this change that guards it until it lands.

| Follow-up                                                                                                            | Size                                                                                        | Guarded by                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Storage port: memory, prompt, profile, ledger and skill stores under one storage folder, SQL moved behind them       | about 69 files (51 importers of the engine, 50 files with SQL, 18 in `turso/`, overlapping) | storage-import ratchet and raw-SQL ratchet                                 |
| Pass config into core and services instead of importing `CONFIG`                                                     | 52 files, 63 import sites                                                                   | `CONFIG` ratchet                                                           |
| Move OpenCode profile learning (`profile-learning.ts`, 824 lines) onto the shared `core/profile-analysis.ts` path    | about 6 files                                                                               | file-size ceiling (baseline 832); host-branch test keeps it in the adapter |
| Split the god modules `user-profile-manager.ts` (1,947 lines), `web-server.ts` (1,837) and `api-handlers.ts` (1,194) | about 15 files                                                                              | file-size ceiling                                                          |
| Web host registry use: derive web host lists and checks from `$shared/hosts`                                         | about 11 files                                                                              | none yet; add a web ratchet with it                                        |
| A test for "every write takes the scope write lock"                                                                  | 1 to 3 files                                                                                | none yet                                                                   |

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-neutral-memory-core`: the SDK boundary names `@opencode/*`; new requirements for the host registry, adapter isolation, the OpenCode entry boundary, host-name comparisons, the modularity ratchets, config loading without importer code, and the scope write lock on web edits.

## Impact

- New code: `src/shared/hosts.ts`, `src/importer/host-importers.ts`, `src/utils/backfill-model.ts`, `src/utils/import-path-config.ts`.
- Changed code (registry): 13 files with host branches (`src/importer/{backfill-controls,import-args,import-readiness,import-sessions,import-sources,map-suggestions,record-past-turns,run-import,web-import-jobs}.ts`, `src/services/{capture-retry-queue,web-server}.ts`, `src/services/ai/live-model-choice.ts`, plus the moved `backfill-model.ts`), the files with host unions (`src/types/index.ts`, `src/core/profile-backoff.ts`, `src/services/{backfill-state,capture-attempt-store,host-appearance}.ts`), `src/importer/settings-models.ts`, `src/importer/{opencode-import,claude-import}.ts`, the importers of `BackfillHost` and `hostLabel`, and `src/types/host-label.ts` (deleted).
- Changed code (other): `src/config.ts` (imports only), `src/importer/import-path-maps.ts`, `src/adapters/{pi,opencode}/backfill-models.ts` (import path), `src/services/api-handlers.ts` (write lock).
- Changed code (built from the registry, after review): `src/importer/{import-runs,import-args,import-readiness,map-suggestions,settings-models,import-sessions,web-import-jobs,record-past-turns}.ts`, `src/services/{capture-attempt-store,capture-retry-queue,settings-snapshot}.ts`, `src/cli/skills-record-past.ts`, and two message lines in `src/services/web-server.ts`.
- Web: `web/src/lib/host-label.ts`, `web/src/lib/auto-import-settings.ts`, `web/src/lib/components/memory/DirectoryMapsSection.tsx` (type lines only).
- Tests: 6 new test files and 1 helper; pattern updates in `tests/pi-adapter-boundary.test.ts` and `tests/claude-code-adapter-boundary.test.ts`; import-path updates in `tests/import-path-maps.test.ts`, `tests/omms-config.test.ts` and `tests/backfill-model.test.ts`; added characterisation cases (no assertion changed) in `tests/{import-runs,import-args,import-readiness,import-handled-listing,skills-record-past,web-settings-api}.test.ts`.
- Docs: `AGENTS.md`, `docs/shared-core.md`, `docs/adr/050-*.md`, `docs/adr/ADR_README.md`, `docs/tdr/081-*.md`, `docs/tdr/README.md`.
- About 70 files in one pull request. No dependency, config key, default or API change.
- Release: `refactor:` and `test:` commits are hidden from the changelog; the write-lock fix is a `fix:` commit and starts a patch release.
