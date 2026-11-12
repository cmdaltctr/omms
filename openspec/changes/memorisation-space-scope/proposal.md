# Proposal

## Why

A memorisation is a note the user saves on purpose and fetches by ID, label or text. Today OMMS reads only the memorisations of the current project, which it derives from the folder the caller runs in. Notes then look lost when the caller is in another folder. The web app is the clearest case: as a login item it runs in `/`, so the Memorisation page and its recall box show nothing. On 2026-11-11 the user's two `omrs` notes (`ms-xhsw5q`, `ms-0revrr`) were in the store but not on the page. The user wants a memorisation to be a neutral note bound to the memory space, not to a project.

## What Changes

- **BREAKING** `recall` by ID, by text and by labels reads every project in the active space and its linked spaces. An ID saved in another project is found. Before this change it was "not found".
- **BREAKING** The Memorisation page lists every memorisation in the active and linked spaces. It no longer depends on the folder the web app runs in.
- **BREAKING** Bulk delete removes memorisations of any project in the active space. It still never touches a linked space.
- `memorise` adds the project name as an ordinary label, for example `omrs`. All worktrees and branches of one repository give the same name. A folder outside git gives the folder name. The label is not added twice.
- A new global setting, `memorisationRerank` (default off, marked experimental), lets text recall reorder its matches with the reranker server that is already configured for memory search. Memorisation recall no longer follows the general `rerankerEnabled` switch.
- The Memorisation settings card gets an experimental switch for `memorisationRerank`. The switch stays visible and disabled, with the reason, until a reranker server URL and model are set.
- Spaces stay the boundary. A new space has no memorisations until the user imports, transfers or links them.
- Session snapshot replacement keeps its current lookup, which uses the project and the host session ID.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memorisation`: recall, the list route and bulk delete read the whole active space and not only the current project. `memorise` adds a project label. A new setting turns on reranked text recall.
- `web-memorisation`: the list shows the whole active space. The settings card adds the experimental rerank switch.

## Impact

- Code: `src/core/memorisation-operations.ts`, `src/core/memorisation.ts`, `src/core/memorisation-settings.ts`, `src/services/memorisation-store.ts`, `src/services/memorisation-routes.ts`, `src/services/reranker.ts`, `src/services/linked-search.ts`, two small edits in `src/services/client.ts`, one call line each in `src/core/memory-operations.ts` and `src/services/web-route-modules.ts`, `src/config.ts`, `src/config-template.ts`, `src/services/global-config-writer.ts`, `src/services/settings-snapshot.ts`.
- Web: `web/src/lib/components/memorisation/MemorisationSettings.tsx`, a new rerank switch component, `web/src/hooks/useMemorisationSettings.ts`, translations in English, Chinese and Arabic.
- Hosts: OpenCode V2, Pi, Claude Code and the CLI all call the shared `runMemorise` and `runRecall`, so all four change together with no adapter edits.
- Docs: `docs/using-memory.md`, `docs/web-ui-memory.md`, `docs/configuration.md`, a new ADR-049 that replaces decisions 5 and 12 of ADR-047.
- Data: no schema change and no row rewrite. Memorisations saved before this change keep their labels and gain no project label.
