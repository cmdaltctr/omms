# Design

## Context

See proposal.md for the reason. These facts about the code at `main` (eac29d8) decide the approach:

- The store classes are singletons bound to `CONFIG.storagePath`. `TursoShardManager` builds the `metadata.db` path and every shard path from it (`shard-manager.ts`). `TursoConnectionManager` refuses any database outside `CONFIG.storagePath` and `CONFIG.skillStoragePath` (`assertPathInsideStorage`). `withCrossProcessWriteLock` and `acquireTursoOperationLock` take the lock folder from `CONFIG.storagePath`. `UserProfileManager` takes its database and `cold-buffer.json` paths from `CONFIG.storagePath`.
- A space is one folder with the layout of the Default store (ADR-041). A switch resets every registered handle through `resettable()`.
- A memory is one row in a shard database. The row holds the project tag (`omms_project_<hash>` or `omms_user_<hash>`), text, tags, type, times, metadata, project fields, `is_pinned` and two vectors. A project tag hashes a project identity (`src/services/tags.ts`): a marker root (`path:`), else the local git common directory (`git-common:<absolute path>`), else the remote URL (`remote:<url>`). In a normal clone the identity is the local `.git` path, so tags are machine-local and a colleague on the same repository gets a different tag.
- The embedding settings are global (`CONFIG.embeddingModel`, `embeddingDimensions`). Every space created on this machine uses them, so a copy between two local spaces can reuse the stored vectors.
- All hosts recall through `memoryClient.searchMemories` (`src/services/client.ts`): the retrieval sections (`src/core/retrieval.ts`), the `memory` tool `search` and the chat retrieve. The list surfaces go through `memoryClient.listMemories`: the capture step reads the latest memory (`src/core/capture.ts`), the session-start recent list and the `memory` tool `list` use it too. The profile step uses `searchMemoriesBySessionID`, and the dedupe service reads shard rows directly.
- `executeSpaceOperation` (`src/services/spaces/operations.ts`) is the one function behind the CLI `space` command, the `memory` tool `space` mode and the Claude Code tool. It needs no open store today.
- `src/services/memory-portability-service.ts` exports and imports one **project** for the **active** space, keeps `userName`, `userEmail`, `projectPath` and `gitRepoUrl`, and maps every memory onto the importing project's tag. It stays as it is.

## Goals / Non-Goals

**Goals:**

- Read and write any two spaces without switching the active space and without changing the hosts' store.
- A transfer that never loses a memory: copy first, check, then remove.
- An export file that is safe to hand to a colleague, with a final scan as a safety net.
- One implementation of each operation, shared by the web app, the CLI and the tool.

**Non-Goals:**

- Changing `memory-portability-service.ts` or its `export` and `import` commands.
- Transitive links, two-way sync, or merging user profiles between spaces.
- Mapping each imported project onto its own local project. Import keeps the project tags by default, or maps all of them onto one project the user names (D7).
- Per-space embedding settings.
- A background job queue. A transfer runs inside the request.

## Decisions

### D1. A space-bound store takes its root folder as an argument

Add `src/services/spaces/space-store.ts` with `openSpaceStore(folder, mode)`. It returns its own connection manager, its own shard manager and, for a write, its own write locks, all rooted at `folder`. To make that possible:

- `TursoConnectionManager` takes an optional `allowedRoots: () => string[]` (default: the two `CONFIG` roots).
- `TursoShardManager` takes `{ root: () => string, connections }` (default: `CONFIG.storagePath` and the shared manager).
- `withCrossProcessWriteLock`, `acquireTursoOperationLock` and `assertNoTursoMigrationInProgress` take an optional `root`. The write path of `getWriteShard` checks the migration lock, so a space-bound store must check its own folder, not the active space's.
- `UserProfileManager` takes an optional `root` (needed only for profile import, D8).

The singletons keep their current constructor defaults, so hosts see no change. The space store uses the **same lock files** as a host that has that space active, so a transfer and a capture exclude each other.

Alternatives rejected:

- _Swap `CONFIG.storagePath` for the length of a call._ It is global state. A host turn or a web request in the same process would read or write the wrong space.
- _Require the target to be active._ A move between two non-active spaces would need a switch, which hits every host.
- _Run the transfer in a child process with another storage path._ Slow to start, hard to report progress, and it duplicates the config loading.

### D2. Two open modes

- **Write** (transfer target, import target, move source): opens the folder, takes the write lock per scope, creates a shard when the scope has none.
- **Read** (transfer source for a copy, preview, linked search): opens only files that exist, runs `PRAGMA query_only = ON`, creates no file, runs no schema change and takes no lock. A missing `metadata.db` means an empty space.

A read store for a linked space is cached by folder for the life of the process and registered with `resettable()`, so a switch or a registry change closes it. A write store lives for one operation and is closed in `finally`. The store handle coverage test (`tests/store-handle-coverage.test.ts`) lists the new module and the cache. No new `.db` name is added.

### D3. The transfer engine is pure over two small interfaces

`src/services/spaces/transfer.ts` takes a `SourceReader` and a `TargetWriter` and holds no `CONFIG` import. Steps:

1. **Select.** Read source rows with `created_at` in the range and, when given, the project filter. A "project" is the value of `project_name` with its tag. User-scope rows appear as one group named "Personal".
2. **Skip duplicates.** Load the target's ids and its `container_tag` + text keys once. Drop a source row that matches either (spec: exact duplicates).
3. **Preview** stops here: count, groups, five examples (text cut to 160 characters, for the screen only and never logged) and the skipped count.
4. **Write.** Group the rows by scope and hash. For each group, write in batches that fit the shard's free room (`maxVectorsPerShard`) in one transaction per shard, then set the shard's vector count. The stored vectors are reused only when the source shard's model and dimensions equal the current settings (the spec's rule). Otherwise the engine embeds again.
5. **Check.** Select the copied ids from the target. Every id must be present.
6. **Remove (move only).** Delete the checked ids from the source in one transaction per shard and fix the counts. A missing id at step 5 aborts before this step.

A failure in step 4 rolls back the open transaction. Earlier batches stay, which is safe because a re-run skips them as duplicates (same id). The result says how far it got.

A crash between steps 5 and 6 leaves memories in both spaces. A re-run reports them as duplicates and does not remove them (spec: skipped duplicates stay in the source). This window is a few milliseconds long, and the user can delete the leftovers in the source. We accept it and note it in the guide.

### D4. One transfer at a time per process

The web server holds an in-process mutex for apply calls and answers 409 `transfer-busy` to a second one, without touching either space. The dialog shows the refusal in words and keeps the preview, so the user can retry (web spec: only one transfer applies at a time). The cross-process write lock covers the other processes.

### D5. Links live in the registry

`SpaceEntry` gains `links?: string[]` (space ids). `registry.ts` gains pure `linkSpace` and `unlinkSpace` with the checks of the spec (no self, no repeat, space exists). `parseEntry` accepts a missing `links` and rejects a non-array. A link to a deleted or archived space stays in the file and shows as unavailable. `readRegistryFile` and `configSignature()` need no change, because a link change rewrites `spaces.json`.

### D6. Linked search is opt-in per caller

`searchMemories(query, tag, scope, { includeLinked })` and `listMemories(tag, limit, scope, { includeLinked })` default to `false`. Recall surfaces pass `true`: the retrieval sections for the three hosts (`src/core/retrieval.ts`), the session-start recent list (`buildRecentMemoriesSection`), the `memory` tool `search` and `list`, and the chat retrieve. The capture step, the profile step (`searchMemoriesBySessionID`), the dedupe reads and the duplicate checks keep the default, so a capture never decides on a linked memory and never writes to one.

With `includeLinked`:

1. Run today's own search unchanged (reranker included).
2. For each linked space that is available, open a cached read store, check the dimensions and, when the space records an embedding model, the model, then call `searchAcrossShards` with the **same query vector** and the same threshold.
   Skip the space with a warning on any difference. A space that records no model (a legacy shard) passes on the dimensions alone, so existing spaces keep working. The model rule is stricter than today's `hasMatchingEmbeddingDimensions` check on the own space, on purpose: a linked space is searched with a vector it never produced, and a model mismatch with equal dimensions returns wrong results without any error. This is the same rule D3 uses for vector reuse.
3. Append linked results after the own results, sorted by similarity, up to the result limit (`CONFIG.maxMemories`). The reranker does not see linked results.
4. Set `spaceName` on each linked result. Add a warning for each skipped link.
5. A list with `includeLinked` appends linked rows after the own rows, newest first, up to the limit. No query vector is involved.

`src/services/context.ts` prints a `space="<name>"` attribute on a linked `<memory>` element, after the `relevance` attribute: the Claude Code recall parser (`hooks/omms-recall-parse.js`) matches `<memory id="..." relevance="...">` in that order, and `ci:local` never runs `test-claude-mod.sh`, so a wrong order would break Claude Code recall unnoticed. That script stays a gate.

`forget` and `edit` look in the own space first. On "not found" they check the linked read stores and, when the id is there, refuse with the space name.

Alternative rejected: always search linked spaces. The capture step would then skip a memory that exists only in a linked space.

### D7. Export and import

New files in `src/services/spaces/`: `export-space.ts`, `import-space.ts`, `identifier-scrub.ts` and a schema `src/shared/api/space-export-schemas.ts` (`format: "omms-space-export"`, `schemaVersion: 1`). The v1 project export stays untouched.

**Export.** Read the source (read store). For each memory keep id, text, tags, type, times, pin and project tag. Drop `displayName`, `userName`, `userEmail`, `projectPath`, `projectName`, `gitRepoUrl` and any metadata key whose value is a path or one of those identifiers. Run every remaining string (text, tags, metadata values) through `identifier-scrub.ts`: home-folder paths (`/Users/<x>/`, `/home/<x>/`, `C:\Users\<x>\`) become `~/`, email addresses become `<email>`, and `<private>` regions are removed (`stripPrivateContent`). The scrubber returns counts. As a last step the exporter scans the serialised file for the home path of the exporting user, any other home-folder path shape and any email pattern, and **fails the export** if one is left. Other absolute paths (a system path or a URL) stay in free text and the scan does not fail on them, because memories often quote such paths. A test feeds hostile metadata to prove this.

The opt-in adds the user-scope memories and the profile. Profile items keep category, description, confidence, frequency, evidence and times. They lose `centroid`, `anchor` and the other vector fields, and every string is scrubbed.

The file is a JSON document. The web route returns it as a download (`Content-Disposition`). The CLI writes it atomically (temporary file, then rename) to `--out`.

**Import.** Validate first (size cap 100 MB, schema, version). Compare `embedding.model` and `dimensions` with `CONFIG` and return the warning. The user names the new space and the file holds no space name. Create the new space (`createStoredSpace`). Open a write store on its folder. Embed every memory with the current model, in batches, then write with the same shard code as D3. User-scope memories are written under the importing user's user tag. Project memories keep the exporter's tags by default, so a round trip on one machine and a same-machine backup restore stay exact. A project-scope search on another machine then finds them only when that project's identity hash matches; an all-projects search always finds them (see Risks). With the option `retagToProject` (a folder), the import computes that folder's tag once with `getProjectTagInfo(folder)` and gives it to every project memory. The folder must exist, and the check runs before the space is created. The folder is used for the hash only and is stored nowhere. This merges the file's projects into one, and the dialog and CLI say so with the project count from the file. User-scope memories are not affected. The profile, when present, is created through a `UserProfileManager` rooted at the new folder. If anything fails, remove the registry entry and the folder of the new space (it was never active and holds only imported data, so no backup is needed) and report the error.

### D8. Surfaces and parity

- `operations.ts` gains the actions `preview`, `copy`, `link` and `unlink`, and the refusals: `move` is web only; `export` and `import` are refused for the tool and allowed for the CLI.
- New tool arguments on `MemoryOperationArgs`: `spaceTo`, `spaceSince`, `spaceUntil`, `spaceProject`, `spaceIn` (the space that owns a link; default is the active space). Dates are ISO 8601.
- CLI: `space preview|copy --from <a> --to <b> [--since D] [--until D] [--project P]`, `space link|unlink <name> [--in <space>]`, `space export <name> --out <file> [--since D] [--until D] [--include-profile]`, `space import <file> --name <new> [--retag-to-project <folder>]`.
- The Pi extension, the OpenCode V2 adapter and the Claude Code tool schema carry the new arguments. `tests/memory-space-tool-parity.test.ts` grows to cover them.
- Because the new actions open stores, `runSpaceMode` loads them with dynamic `import()` only for those actions, so `list`, `use` and `create` stay light.

### D9. Web API

All under `/api/spaces`, in a new `space-transfer-routes.ts` (kept apart so `space-routes.ts` stays under 500 lines), with the existing auth and loopback rules:

| Route                               | Purpose                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `POST /api/spaces/transfer/preview` | Body: from, to, mode, since, until, projects. Returns the preview.     |
| `POST /api/spaces/transfer`         | Same body plus `confirm: true`. Runs copy or move. Returns the result. |
| `POST /api/spaces/:id/export`       | Body: since, until, `includeProfile`. Returns counts and a download.   |
| `POST /api/spaces/import/check`     | Uploads the file, returns counts, projects and the model warning.      |
| `POST /api/spaces/import`           | Uploads the file with the new name and optional `retagToProject`.      |
| `POST /api/spaces/:id/links`        | Body: `{ add }` or `{ remove }`.                                       |

`GET /api/spaces` adds `links: [{ id, name, available }]` to each space. The upload handler must take bodies up to 100 MB. Task 8.1 checks the current body limit of the web server and raises it for this route only.

### D10. Web UI

New components in `web/src/lib/components/spaces/`: `TransferDialog`, `TransferPreview`, `ExportDialog`, `ImportDialog`, `SpaceLinks`. They follow `web/AGENTS.md`: shared `Button` and dialog primitives, `SpaceActionButton` with tooltips for the new Transfer and Export icons, `SpaceConfirmDialog` for the confirmations, logical classes for Arabic, `<bdi>` around names. Strings go in a new `web/src/lib/i18n/spaces-transfer.ts` in `en`, `zh` and `ar`. The browser check at 1280 px and 390 px runs in a scratch HOME with its own port. The page and dialog patterns go into the `omms-design` skill (`references/components.md`). The web part is large: a sub-agent builds it after the API is done.

## Risks / Trade-offs

- [The root parameter touches shared store classes] → Defaults keep today's behaviour. The existing shard, connection and lock tests must pass unchanged. A new test opens two space stores in one process and writes to each.
- [A transfer writes to a space that a host has active] → The same lock files and the same operation lock apply. A test runs a transfer while a second writer holds the lock and expects a wait, not corruption.
- [Move interrupted between check and remove] → See D3. Memories exist twice, none is lost.
- [Free-text names inside memory text are not detected by the scrubber] → The export result and the guide say so. The web dialog shows the counts and the same sentence.
- [A linked read store holds file handles] → Cached per process, closed by `resettable()`. Read mode creates no WAL files that a backup or delete of the linked space would trip on. Delete of a space closes its cached read store first.
- [Linked results change recall quality] → Own results always rank first and linked ones only fill the remaining places. Linking is off by default.
- [Large exports and imports] → The 100 MB cap stays. Import embeds in batches and reports progress.
- [A space imported with another model than its stored vectors] → Import always embeds again, so vectors match the settings.
- [Imported memories carry the exporter's project tags] → Tags are machine-local (Context), so a project-scope search on the importing machine finds them only under a matching identity hash. An all-projects search always finds them. The user can map them onto one local project with `retagToProject` (D7). The guide and the import result say so.

## Migration Plan

No data migration. `links` is optional, so an older `spaces.json` stays valid, and an older OMMS reading a newer file ignores the field. Rollback: install the previous version. Linked spaces then stop working, and nothing else changes.

## Open Questions

None that change the specs. Defaults taken in this design, open to the reviewer at approval:

- User-scope (personal) memories travel with the profile opt-in and are retagged to the importing user.
- Export and import are offered in the web app and the CLI, and not to the agent tool.
- A Move uses a confirm dialog with the counts, not a typed name.
