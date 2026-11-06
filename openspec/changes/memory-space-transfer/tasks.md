# Tasks

Write each test first and prove that it fails on the old code. Run one file with `PATH=/opt/homebrew/bin:$PATH bash scripts/run-tests-isolated.sh tests/<file>.test.ts`. Tests that open databases clean up with `cleanupTursoTestDirectory` (`tests/turso-test-utils.ts`) and build expected paths with `join`. Make a mutation check for each safety rule.

## 1. Space-bound store

- [ ] 1.1 Give `TursoConnectionManager` an optional `allowedRoots` provider, `TursoShardManager` an optional `{ root, connections }`, and `withCrossProcessWriteLock` and `acquireTursoOperationLock` an optional `root` (D1). The defaults keep the `CONFIG` behaviour. Verify that the existing shard, connection, lock and store-handle tests pass unchanged, and add `tests/space-store-roots.test.ts` that writes to two folders from one process and finds each memory only in its own folder. Confirm that the test fails on the old code.
- [ ] 1.2 Add `src/services/spaces/space-store.ts` with `openSpaceStore(folder, mode)` (D2). Write mode creates the shard on demand and takes the write lock. Read mode opens existing files only, sets `query_only`, creates no file and treats a missing `metadata.db` as empty. Verify with tests: a read open leaves every file byte-identical, a read of a missing folder returns empty, a write store and a host-style writer on the same folder exclude each other, and `close()` releases the files (Windows-safe).
- [ ] 1.3 Add the cached read store for linked spaces and register it with `resettable()`. Add the new module and the cache to `tests/store-handle-coverage.test.ts`. Verify that the coverage test fails when the registration is removed.
- [ ] 1.4 Give `UserProfileManager` an optional `root` (D1) for profile import. Verify that the existing profile tests pass unchanged and that a manager rooted at a temporary folder reads and writes only there.

## 2. Registry links

- [ ] 2.1 Add `links?: string[]` to `SpaceEntry`, accept a missing field in `parseEntry`, and add pure `linkSpace` and `unlinkSpace` (D5) with the checks of the spec: no self-link, no repeat, the space exists, no transitive use. Verify in `tests/spaces-registry.test.ts`: an older file without `links` stays valid, a self-link and a repeat are refused, an unlink keeps the other links, and an archived or removed linked space stays in the file and reads as unavailable.
- [ ] 2.2 Add `linkStoredSpace` and `unlinkStoredSpace` to `registry-store.ts` under the existing lock and atomic write. Verify with a concurrent-writer test that no update is lost, and that `configSignature()` changes after a link change.

## 3. Transfer engine

- [ ] 3.1 Add `src/services/spaces/transfer.ts` (D3) with select, duplicate skip and preview over a `SourceReader` and a `TargetWriter`. Verify in `tests/space-transfer-preview.test.ts`: the date range is inclusive, the project filter works, "Personal" groups user-scope rows, the examples are at most five and cut at 160 characters, an empty match gives zero, and a preview changes neither store.
- [ ] 3.2 Add the duplicate rule. Verify with tests for the same id, the same text under the same tag with another id, similar text that is kept, and the same text under another tag that is kept.
- [ ] 3.3 Add the copy step with batching to the shard capacity, vector reuse when the dimensions match and re-embedding when they differ. Verify that every field (text, tags, type, times, pin, metadata, tag) arrives unchanged, that the source is untouched, that a forced write error leaves no partial batch in the failed transaction, and that a re-run after a failure skips what arrived, and that an apply after the source changed between preview and apply copies what matches at apply time and reports the changed count.
- [ ] 3.4 Add the check and remove steps for move. Verify: all copied ids are removed from the source, duplicates stay in the source, a missing id at the check removes nothing, and the vector counts of both stores are right. Mutation check: skip the check and watch the test fail.
- [ ] 3.5 Wire the engine to two space stores in `src/services/spaces/transfer-service.ts`, with the archived-space and same-space refusals and the log of counts and ids only. Verify with a test that no memory text appears in the captured log output.

## 4. Operations, CLI and tool

- [ ] 4.1 Add `preview`, `copy`, `link` and `unlink` to `executeSpaceOperation`, refuse `move` with the web app message, and refuse `export` and `import` for the tool (D8). Verify in `tests/memory-tool-space.test.ts`: each action works, `move` is refused, and `delete`, `rename`, `backup` and `restore` are still refused.
- [ ] 4.2 Add the tool arguments `spaceTo`, `spaceSince`, `spaceUntil`, `spaceProject` and `spaceIn` to `MemoryOperationArgs`, the Pi extension, the OpenCode V2 adapter and the Claude Code tool schema. Verify with `tests/memory-space-tool-parity.test.ts` extended to the new actions and arguments, and with `bash scripts/test-claude-mod.sh`.
- [ ] 4.3 Add the CLI forms `space preview | copy | link | unlink | export | import` with the flags of D8, in a file that keeps `space-command.ts` under 500 lines. Verify in `tests/cli-space.test.ts`: help text, a bad date, an unknown space, the refusal of `move`, and `space import --retag-to-project` with a missing folder.

## 5. Linked search

- [ ] 5.1 Add `includeLinked` to `searchMemories` and `listMemories` (D6), the append-after-own merge, `spaceName` on a linked result and the warning for a skipped link. Verify in `tests/linked-search.test.ts`: own results first, linked results fill only the free places, the same query vector is used, a list with links appends the linked rows after the own rows newest first, a missing or archived linked space is skipped with a warning, a dimension mismatch is skipped with a warning, a model mismatch with equal dimensions is skipped with a warning, a space with no recorded model is read when the dimensions match, links are not followed further, and the linked folder is byte-identical afterwards.
- [ ] 5.2 Pass `includeLinked: true` from the recall surfaces only: `src/core/retrieval.ts` (the prompt section and the session-start recent list), the `memory` tool `search` and `list`, and the chat retrieve, through `searchMemories` and `listMemories`. Verify with tests that the capture step and the profile step do not read linked spaces, and that a capture writes only to the own space while links exist. Mutation check: default `includeLinked` to `true` and watch the capture test fail.
- [ ] 5.3 Print `space="<name>"` on a linked `<memory>` element in `src/services/context.ts`. Verify with context tests (linked label present, own memory without a label) and run `bash scripts/test-claude-mod.sh` to confirm that the Claude Code recall parser still reads the block.
- [ ] 5.4 Make `forget` and `edit` refuse a memory of a linked space with the space name. Verify with a test that the linked memory is unchanged and the message names the space.
- [ ] 5.5 Close the cached read store of a linked space when the web app deletes that space (D2). Verify with a test that the files are released (Windows-safe), that the link reads as unavailable, and that a later search skips it with a warning.

## 6. Export

- [ ] 6.1 Add `src/services/spaces/identifier-scrub.ts` and its tests in `tests/identifier-scrub.test.ts`: `/Users/x/`, `/home/x/` and `C:\Users\x\` become `~/`, emails become `<email>`, counts are returned, and `<private>` regions are removed.
- [ ] 6.2 Add `src/shared/api/space-export-schemas.ts` and `src/services/spaces/export-space.ts` (D7). Verify in `tests/space-export.test.ts`: no vector field, no `projectPath`, `projectName`, `userName`, `userEmail`, `displayName` or `gitRepoUrl`, metadata keys that hold paths are gone, the project tag is kept, the date range filters, an empty selection writes no file, the write is atomic, the space is unchanged, and a fully private memory is left out of the file.
- [ ] 6.3 Add the final safety scan. Verify with a test that feeds a home-folder path and an email that the scrubber cannot see (for example a nested metadata value) and expects the export to fail with a reason. Mutation check: remove the scan and watch the test fail.
- [ ] 6.4 Add the opt-in for the profile and user-scope memories, with centroid, anchor and name fields removed from profile items. Verify that the default export holds neither, and that the opt-in file holds both without any vector, name or email.

## 7. Import

- [ ] 7.1 Add `src/services/spaces/import-space.ts` (D7): validation before any space exists, the model and dimension warning, a new space only, re-embedding, user-scope memories retagged to the importing user, the optional `retagToProject` folder (D7), and the profile written through the rooted profile manager. Verify in `tests/space-import.test.ts`: a taken name is refused and changes nothing, project tags are kept by default, `retagToProject` gives every project memory the tag of that folder and leaves user-scope memories alone, a missing folder is refused before any space exists, an invalid, oversized or newer-schema file creates no space, a matching model gives no warning, a different model gives a warning that names both, vectors are created with the current model, and the active space is unchanged.
- [ ] 7.2 Add the failure path. Verify that a forced embedding error removes the new registry entry and folder and leaves every other space byte-identical.
- [ ] 7.3 Round trip. Verify that an export from space A imported as space B gives the same count, texts (after scrubbing) and project tags (default import, no retag), and that a search in B finds a memory by meaning. Add a second round trip with `retagToProject` and verify that a project-scope search from that folder finds every project memory.

## 8. Web API

- [ ] 8.1 Check the web server body limit and raise it for the import routes only (D9). Verify with a route test that a 20 MB body passes and that other routes keep their limit.
- [ ] 8.2 Add `src/services/space-transfer-routes.ts` with the transfer, export, import (with optional `retagToProject`) and links routes of D9, the in-process transfer mutex (409 `transfer-busy`), and `links` in `GET /api/spaces`. Verify with route tests for each route and each refusal in the specs, including auth and loopback rules, a second apply during a running one (409 `transfer-busy`, neither space changed, the first apply finishes), and a move that the web route allows while the tool refuses.
- [ ] 8.3 Return the export as a download with `Content-Disposition`. Verify that the response body equals the CLI file for the same input.

## 9. Web UI

- [ ] 9.1 Add `web/src/lib/i18n/spaces-transfer.ts` with every string in `en`, `zh` and `ar`. Verify with `web/tests` parity checks (`tests/web-translations-parity.test.ts`).
- [ ] 9.2 Build `TransferDialog` and `TransferPreview` (preview before apply, clear on filter change, Move confirm dialog with counts, result with skipped count). Show the `transfer-busy` answer in words, keep the preview and leave Apply available. Verify with specs in `web/tests/` for each scenario of `web-memory-space-transfer`, and a mutation check that removes the clear-on-change rule.
- [ ] 9.3 Build `ExportDialog` (unticked opt-in, counts, download) and `ImportDialog` (file, name, a "keep project labels" default with an optional project folder field that says the file's projects will merge into one and shows the project count, model warning, confirmation, taken-name error, missing-folder error). Verify with specs for each scenario.
- [ ] 9.4 Build `SpaceLinks` on the card (list, unavailable mark, link control, unlink with confirmation) and add the Transfer and Export icon buttons to `SpaceCard` with tooltips. Verify with specs for the card actions and the links scenarios.
- [ ] 9.5 Browser check in a scratch HOME on its own port, at 1280 px and 390 px, in English and Arabic, light and dark. Restart the preview server after every rebuild. Verify by screenshots and list anything not checked.
- [ ] 9.6 Add the new dialog and links patterns to the `omms-design` skill (`references/components.md`) and to `web/AGENTS.md`. Verify that Prettier passes.

## 10. Documentation and records

- [ ] 10.1 Update `docs/memory-spaces.md` (transfer, export, import, links, the limits and the move window of D3), `docs/cli.md`, `docs/web-ui.md`, the `omms-memory` skill and `README.md`. Remove the sentence that says spaces cannot move memories. Add new guides to `docs/README.md`. Verify that Prettier passes and that each documented command runs as written in a scratch HOME.
- [ ] 10.2 Write ADR-042 (the space-bound store and the link rules) and a TDR for each build finding, and add them to the index files in `docs/adr/` and `docs/tdr/`.

## 11. Live checks and gates

- [ ] 11.1 Live check in a scratch HOME with its own port and store: create three spaces, copy by date range, move in the web app, export without and with the opt-in, import into a new space, link and search. Run a real Pi and a real Claude Code turn that recalls a linked memory (symlink `"$HOME/Library"` into the scratch HOME for the Keychain). Verify the labels in both hosts and list what was not verified.
- [ ] 11.2 Run `PATH=/opt/homebrew/bin:$PATH bun run ci:local` and read the real `EXIT` line, then `bash scripts/test-claude-mod.sh` and `openspec validate memory-space-transfer --strict`. Report the exact output and the tested commit SHA.

## Workflow follow-up

- Build in this one worktree and commit in two groups, each after its tasks pass: group A is tasks 1 to 5, the transfer and links parts of 8 and 9 (8.2, 9.1, 9.2, 9.4), and their docs. Group B is tasks 6 and 7, 8.1, 8.3, 9.3, and their docs. Group B needs group A, never the reverse. Decide at pull request time: if the diff is too large to review, branch group B off at the group A commit and open two pull requests (B after A merges). Otherwise open one.
- Run `/opsx:verify`, then `/opsx:archive` in the same pull request.
- Ask the user before commit, push and pull request. Use a `feat:` commit. Merge only on the user's word.
- After the merge, copy out the gitignored files the project lists, remove the worktree and the branch locally and on GitHub, and run `git pull --ff-only` in the main checkout.
