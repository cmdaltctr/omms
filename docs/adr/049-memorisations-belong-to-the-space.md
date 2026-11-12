# ADR-049: Memorisations belong to the space

- **Date:** 2026-11-12
- **Status:** Accepted
- **Deciders:** OMMS maintainer
- **Change:** [`memorisation-space-scope`](../../openspec/changes/archive/2026-11-12-memorisation-space-scope/proposal.md)

## Context

ADR-047 bound every memorisation read to the project folder of the caller. That folder comes from where the host runs. The web app runs in `/` when it starts as a login item, so the Memorisation page showed nothing while the store held the user's notes. The same fault hits any agent that runs outside the repository the note was saved in.

The user wants a memorisation to be a neutral note bound to the memory space, not to a project. The space is already the store boundary (ADR-041, ADR-042): one storage folder, optional read-only links to other spaces.

Facts from the code that shape the decision:

- The memory client already reads every project when the scope is `"all-projects"`, and `readLinkedMemory` accepts `null` for "any project".
- A memorisation ID is already unique across the whole space; `memorisationIdTaken` ignores the project.
- The project name comes from `getProjectTagInfo`. For git it is the folder above the shared `.git` folder, so every worktree of one repository gives the same name.
- `rerankSettingsFrom` turns the general `rerankerEnabled` switch into reranker settings for every search, and `runRecall` sorts its matches by confidence again, which undoes the reranker's order.

## Decision

1. **Every memorisation read covers the whole active space and its linked spaces.** Recall by ID, by text and by labels, the list route and bulk delete call the memory client with scope `"all-projects"` and an empty project tag; `getMemorisationById` and `deleteMemorisation` take `null` for "any project". This reuses paths that normal memory already tests. A new "space" scope value was rejected: it would touch `resolveMemoryScope` and every `MemoryScope` caller for no gain.
2. **Memorise adds the project name as an ordinary label.** The name is trimmed and lower-cased like any label and merged into the caller's labels in `runMemorise`, once at most. The name `/` adds no label. Every host runs the shared core, so no adapter changes. Filtering by project is therefore filtering by label, and notes saved before this change keep working with the labels they have.
3. **`memorisationRerank` decides whether text recall reranks; `rerankerEnabled` does not.** The new global boolean (default `false`, experimental) reaches recall as the `reranker` override of `MemoryReadOptions`. A new helper, `rerankSettingsFor(config, override)`, maps the override to reranker settings: `false` never reranks, `true` reranks whenever the server URL and model are set, no override keeps the general rule. The reranker server settings (URL, model, key, timeout) stay shared with memory search, so the user configures one server. A separate server for memorisations was rejected: it repeats four settings for an experimental feature.
4. **Reranked recall keeps the search order and the content-only confidence.** With reranking on, `runRecall` does not sort by confidence again. The client returns own-space rows in the reranker's order, or in content-score order when the reranker fails, then appends linked rows; the reranker never sees linked rows. Each match keeps its content-only confidence score, so the number means the same thing with or without the reranker, and the one-strong-match rule reads the first two matches in the returned order. Mapping the reranker's `relevance_score` to a 0 to 100 confidence was rejected: its range depends on the model, so the 80 and 10-point rules would mean different things per server.
5. **The setting is global-only and lives with the other memorisation settings.** `memorisationRerank` joins `MEMORISATION_KEYS`, accepts only booleans, and a project config cannot set it. The web switch stays visible and disabled, with the reason, until the reranker server URL and model are set.

This replaces decision 5 (recall by ID limited to the current project) and decision 12 (bulk delete limited to the current project) of ADR-047.

## Alternatives Considered

| Option                                            | Rejected Because                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A project picker on the Memorisation page         | It keeps the empty default and adds a control the user must understand.                                                |
| A new `"space"` scope value                       | `"all-projects"` with an empty project tag already walks every shard and the linked readers.                           |
| A `project_name` column instead of a label        | It needs a migration, and label filtering already exists on every host.                                                |
| A backfill of project labels for old notes        | The notes are few and still found by ID, text and their own labels. No row rewrite for a display nicety.               |
| A separate reranker server for memorisations      | Four extra settings for an experimental switch.                                                                        |
| Map the reranker score to the 0 to 100 confidence | The score range depends on the server model, so the 80 and 10-point rules would change meaning per server.             |
| Rerank linked-space rows into the own-space order | Linked spaces are read-only and appended by design (ADR-042); mixing them in would need their rows in the rerank call. |

## Consequences

### Positive

- A note is found from any folder in the space, by ID, label or text, including the login-item web app.
- One label per project keeps projects distinguishable without a new column or a picker.
- The reranker switch for memory search and the switch for memorisation recall are independent.

### Negative

- Text recall from one project can return notes saved in another. Labels narrow the search; a current-project boost stays out until the user sees crowding.
- The exact scan reads every memorisation vector of the space on each text recall (ADR-047 accepted this per project; the space can hold more).
- Bulk delete now reaches every project in the active space. The page confirms with the count first, and linked spaces stay read-only.

### Neutral

- Two unrelated repositories with the same folder name share a label. The user can add a more specific label when memorising.
- Linked-space matches always follow own-space matches when reranking is on. This is the existing linked-space rule.
- Notes saved before this change carry no project label.

## References

- [ADR-041: A memory space is a storage folder](./041-a-memory-space-is-a-storage-folder.md)
- [ADR-042: A space-bound store and linked read-only spaces](./042-a-space-bound-store-and-linked-read-only-spaces.md)
- [ADR-047: Memorisations are a record kind in the memory store](./047-memorisations-are-a-record-kind-in-the-memory-store.md)
- [Configuration: Memorisation](../configuration.md#memorisation)
- `src/core/memorisation.ts`, `src/core/memorisation-settings.ts`, `src/services/reranker.ts`, `src/services/client.ts`, `src/services/linked-search.ts`
- `tests/memorisation-settings.test.ts`, `tests/reranker-settings.test.ts`, `web/tests/memorisation-view.spec.tsx`
