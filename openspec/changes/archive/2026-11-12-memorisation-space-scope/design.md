# Design

## Context

See proposal.md for the motivation. These facts from the code shape the approach:

- Every memorisation read passes the caller's project tag (`getTags(cwd).project.tag`). `runRecall` passes it to `getMemorisationById`, `memoryClient.searchMemories` and `listMemorisationsByTags`. `memorisation-routes.ts` passes it for the list and bulk delete.
- The memory client already reads every project when the scope is `"all-projects"`. It walks all user and project shards and sends an empty project tag to the shard search and to the linked-space readers. `exactScanKind` drops the project filter for an empty tag. `readLinkedMemory` accepts `null` for any project. `findActiveRow` already searches every shard.
- An ID is already unique across the whole space: `memorisationIdTaken` ignores the project.
- The project name comes from `getProjectTagInfo`. For git it uses the folder above the shared `.git` folder, so all worktrees of a repository give one name. Checked on 2026-11-11: `omrs-v3`, `omrs-v4` and `omrs-v3-feat-exp35-freeze-prep` all resolve to the project `omrs`.
- `memoryClient.searchMemories` reranks when the general `rerankerEnabled` is on and the URL and model are set (`rerankSettingsFrom`). `runRecall` then sorts the matches by confidence again, which undoes the reranker's order. Linked-space rows are appended after own-space rows, and the reranker never sees them.
- `src/services/client.ts` has 493 lines. The ceiling is 500.
- The live store holds 2 memorisations, in 1 project.

## Goals / Non-Goals

**Goals:**

- One rule for every reader: a memorisation is found by ID, label or text from any folder, in the active and linked spaces.
- A project label on new memorisations, so filtering by project is filtering by label.
- An experimental reranker switch that affects memorisation recall only.

**Non-Goals:**

- No label editing for memorisations. A memorisation stays read-only. The user deletes it or memorises again.
- No project label backfill for memorisations saved before this change.
- No current-project boost in ranking.
- No change to automatic memory, `search`, `list`, or the general reranker.

## Decisions

1. **Read with the `"all-projects"` scope.** `runRecall` and the list route call the memory client with scope `"all-projects"` and an empty project tag. `getMemorisationById` and `deleteMemorisation` take `null` for "any project". This reuses paths that already exist and are tested for normal memory. The alternative was a new "space" scope value. It would touch `resolveMemoryScope` and every caller of `MemoryScope` for no gain.

2. **The routes stop reading `cwd` for memorisations.** The list, recall and bulk-delete routes no longer derive a project tag. This removes the login-item fault at its source. A project picker was rejected: it keeps the empty default and adds a control.

3. **The project label comes from the project name, added in `runMemorise`.** A pure helper in `src/core/memorisation.ts` merges the normalised project name into the caller's labels without a repeat. The name `/` (a caller in the file-system root) adds no label, because `/` is not a usable label. Memorise runs through the shared core on every host, so OpenCode V2, Pi, Claude Code and the CLI all get the label with no adapter change.

4. **Snapshot replacement keeps the project lookup.** `findSnapshotByHostSession` still matches the project tag and the host session ID. A host session belongs to one folder, so the project part is harmless. Changing it would only widen a query.

5. **`memorisationRerank` decides, and `rerankerEnabled` does not.** `MemoryReadOptions` gets an optional `reranker` override (`true` or `false`). A new helper `rerankSettingsFor(config, override)` in `src/services/reranker.ts` returns the settings for the override, or the general rule when no override is given. `client.ts` changes one line to call it. Memorisation recall always passes the override from `memorisationRerank`. The reranker server settings (URL, model, key, timeout) are shared with memory search, so the user sets the server once. A separate server for memorisations was rejected: it repeats four settings for an experimental feature.

6. **With reranking on, recall keeps the search order.** `runRecall` skips its confidence sort when the override is `true`. The client returns own-space rows in the reranker's order, or in content-score order when the reranker failed, and then appends linked rows. Each match keeps its content-only confidence score, so the number means the same thing with or without the reranker. The one-strong-match rule reads the first two matches in that order. Mapping the reranker's `relevance_score` to a 0 to 100 confidence was rejected: its range depends on the model, so the 80 and 10-point rules would mean different things per server.

7. **The setting lives with the other memorisation settings.** `memorisationRerank` joins `MEMORISATION_KEYS` and `MEMORISATION_DEFAULTS` in `src/core/memorisation-settings.ts` as a boolean, global only. It is saved through `/api/settings` like `memorisationRepeat`. Core code receives it as an argument, never by importing `CONFIG`.

8. **The web switch is its own component.** `RerankSwitch.tsx` sits in `web/src/lib/components/memorisation/` beside `RepeatChoice.tsx`. It uses the shared switch control and the shared `Tooltip`. When the reranker URL or model is missing, it renders disabled inside a focusable `span` with an `sr-only` reason, as the web rules require. Readiness comes from the `/api/settings` snapshot, which already holds `rerankerApiUrl` and `rerankerModel`.

9. **A new ADR-049 records the scope change.** It replaces ADR-047 decision 5 (recall limited to the current project) and decision 12 (bulk delete limited to the current project), and records decisions 3, 5 and 6 above. ADR-047 gets a "Superseded in part by ADR-049" line.

## Risks / Trade-offs

- [Recall from one project returns notes from another] → Labels narrow a search, and every match carries a confidence score. A current-project boost stays out until the user sees crowding. It would be a one-line ranking change.
- [Bulk delete now reaches every project in the active space] → The page already confirms with the count before it deletes. Linked spaces stay read-only.
- [Two unrelated repositories with the same folder name share a label] → Rare. The user can add a more specific label when memorising.
- [A memorisation saved in the home folder gets the user's folder name as a label] → The label stays in the local store, the same as the `project_name` column that already holds it.
- [Linked-space matches always follow own-space matches when reranking is on] → This is the existing linked-space rule (linked rows fill the places left). It is noted in the docs.
- [The exact scan now reads every memorisation vector in the space on each text recall] → The live store holds 2. ADR-047 already accepts this cost while memorisations stay few.
- [Older memorisations have no project label] → They are still found by ID, text and their own labels. The feature shipped on 2026-11-10, and the one known store has both records labelled `omrs`.

## Migration Plan

No schema change and no row rewrite. Deploy with the normal release. Rollback is a revert. An older OMMS ignores the `memorisationRerank` key (task 3.1 checks this), and it reads project-labelled memorisations as ordinary labels.
