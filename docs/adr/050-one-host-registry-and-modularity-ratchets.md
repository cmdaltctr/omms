# ADR-050: One host registry, and ratchets on modularity debt

- **Date:** 2026-11-17
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Change:** [`modular-boundaries`](../../openspec/changes/modular-boundaries/proposal.md)

## Context

OMMS serves three hosts: Pi, OpenCode and Claude Code. Before this change, shared code knew the hosts in many places:

- 39 lines in 13 shared `src/` files compared a host id (`host === "pi"`), switched on one, or listed two or more. 30 of them were in `src/importer/`.
- The host type was written out 12 times in 9 `src/` files (`MemoryHost`, `ImportHost`, `BackfillHost` and inline unions), and 3 more times in `web/src/`.
- About 21 shared `src/` files had to change to add a fourth host, and nothing told you which.
- Several boundary rules lived only in prose: adapters must not import each other, only the OpenCode host loads `src/v2/`, `src/config.ts` must not load importer code.
- Known debt had no limit: 52 core and services files import `CONFIG`, 51 files outside the storage folder import the storage engine, 50 files run raw SQL. Each new use made a later refactor larger.

## Decision

1. **One host list and one host type.** `src/shared/hosts.ts` holds `HOSTS`, `MemoryHost`, `isMemoryHost`, `hostLabel` and `HOST_INFO: Record<MemoryHost, HostInfo>`. `HostInfo` holds identity facts: label, article, command name, whether the host lends a session model, whether it has session commands, its backfill-model config key, and its history source option. The file has no imports, so every layer and the web app (through `$shared/hosts`) read the same list. `ImportHost`, `BackfillHost` and the web `WebHost` stay as one-line aliases of `MemoryHost`.
2. **History parts live in the importer.** `src/importer/host-importers.ts` holds `HOST_IMPORTERS: Record<MemoryHost, HostImporter>`: default source path, source check, picker start folder and file kind, session listing, import run, reader check, worktree hints, and the Settings model list. Readers that load the storage engine stay behind `import()`. Core and services never import this file.
3. **Hosts do not register at run time.** Each host has a static entry in both files. The compiler fails when an entry is missing. Run-time registrations that exist today (`registerHostProfileModel`, `registerOpencodeHostModels`, `registerHostBackfillModels`) stay: they carry access to a running host's model, which is not host identity.
4. **Shared code does not compare host names.** `tests/host-branch-boundary.test.ts` parses every `src/` file with the TypeScript parser. It fails on a host id (including the command name `claude`) in an equality check or a `case` clause, and on two or more host ids in one array, union type, regex, `Set` or `Map` keys. Per-host objects and messages are built from `HOSTS` (for example `hostChoiceMessage()`), and the live-model rule keeps one `LIVE_MODELS` table in `live-model-choice.ts`. Host code (`src/adapters/`, `src/v2/`, `src/plugin.ts`), the two registry files and `src/services/ai/live-model-choice.ts` are allowed.
5. **Each boundary rule has a test.** `tests/module-boundaries.test.ts` checks the host SDK rule (`@opencode/*`, `@opencode-ai/*`, `@earendil-works/*`) in the shared layers, adapter isolation for every folder under `src/adapters/`, that only the OpenCode host imports `src/v2/` and `src/plugin.ts`, that `src/utils/` and `src/config.ts` import no adapter, `src/v2/` or `src/plugin.ts`, and that `src/shared/` imports only itself. `tests/config-boundary.test.ts` checks that `src/config.ts` loads no importer code. The config parsers it needs moved to `src/utils/backfill-model.ts` and `src/utils/import-path-config.ts`.
6. **Known debt can only shrink.** `tests/modularity-ratchets.test.ts` holds three baselines in the style of `tests/file-size-ceiling.test.ts`: non-type `CONFIG` imports in `src/core/` and `src/services/` (52 files), storage-engine imports outside `src/services/turso/` (51 files), and raw SQL literals outside `src/services/turso/` (49 files). A new file starts at 0, a listed file may not grow, a listed file that shrinks must get its new count, and a listed file at 0 must lose its entry. No file but `src/config.ts` may export `CONFIG`, so a re-export cannot hide an import from the ratchet.

## Alternatives Considered

| Option                                                                    | Rejected Because                                                                                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapters register their host at start-up, like `registerHostProfileModel` | The web app serves all three hosts with no adapter loaded, and Claude Code has no in-process adapter. The registry would be empty where it is needed most.       |
| One registry file for identity and history parts                          | Identity facts must load in the web app and in core with no imports. History parts need `node:fs` and the readers. One file would pull readers into every layer. |
| A text scan (regex or ast-grep) for host comparisons                      | Text scans count comments and messages such as "opencode is busy". The syntax tree sees only code.                                                               |
| Fix the debt now: storage port, config injection, god-module splits       | Each touches 40 to 70 files. The ratchets stop growth now; each follow-up change removes one debt and deletes baseline entries.                                  |
| Re-export shims at the old module paths                                   | They keep two names for one thing. Only three tests used the old paths; they changed their import line.                                                          |

## Consequences

### Positive

- Shared `src/` code has 0 host-name branches (39 before) and one host type (12 before).
- A missing registry entry is a compile error. A fourth host edits 4 shared `src/` files: `src/shared/hosts.ts`, `src/importer/host-importers.ts` and `src/services/ai/live-model-choice.ts` (the compiler names all three), and the help text in `src/cli/index.ts`. `docs/shared-core.md` lists them and the extra edits for a host that lends its session model.
- Every boundary rule in `docs/shared-core.md` has a test, and each test has a guard so an empty scan cannot pass.
- New `CONFIG` imports, storage imports or SQL outside the storage folder fail a test with the file name.

### Negative

- The registry spreads over two files. Both are keyed by `MemoryHost`, so they cannot drift without a compile error.
- A branch that adds a `CONFIG` import, a storage import or SQL in a shared file fails the ratchet after rebase. The fix is to pass config in or use the storage folder.
- A fourth host still edits 4 shared `src/` files and at least 9 web files. The web is out of this change.
- Two API objects keep a key order that differs from `HOSTS`: the retry counts in `/api/settings/diagnostics` list OpenCode first, and `effective` in `/api/settings` follows the `LIVE_MODELS` table. Both still need no edit for a new host.

### Neutral

- The SQL scan is case-sensitive and misses concatenated SQL. It only needs to stop the common form from growing.
- No user-visible behaviour changes. Messages, API objects and key order stay the same.

## References

- [ADR-011: Shared code never imports a host adapter](./011-shared-code-never-imports-adapters.md)
- [ADR-013: Claude Code host through hooks and the web app](./013-claude-code-host-through-hooks-and-web-app.md)
- [Shared memory core boundary](../shared-core.md)
- `src/shared/hosts.ts`, `src/importer/host-importers.ts`, `src/utils/backfill-model.ts`, `src/utils/import-path-config.ts`
- `tests/host-registry.test.ts`, `tests/host-branch-boundary.test.ts`, `tests/module-boundaries.test.ts`, `tests/config-boundary.test.ts`, `tests/modularity-ratchets.test.ts`, `tests/source-imports.ts`
