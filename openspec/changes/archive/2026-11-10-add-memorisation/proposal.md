# Proposal

## Why

Agents lose track of where work stopped between sessions. Today the only way to keep a note is `memory add`. That note joins the general store, ranks by fuzzy search, can be deleted as an exact duplicate, and shows up in automatic recall whether the user wants it or not. Users need a small, exact record they save on purpose and fetch on purpose: "what were we going to do with xyz", or "recall ms-4k7q2p".

## What Changes

- New record kind: a **memorisation**. It is stored word for word with a short ID (for example `ms-4k7q2p`) and the label `memorisation`. Nothing merges, rewrites or ages it out.
- Two kinds of memorisation:
  - **Session snapshot**: short fields for done, doing and next, written by the agent from what it already holds in context. It never reads the whole session history.
  - **Explicit**: text the user gives, stored as given.
- Size cap on every memorisation, so a recall costs few tokens. The user sets it in characters or estimated tokens, in the config file or on the Memorisation page (default 2,000 characters).
- New `memorise` and `recall` modes on the `memory` tool for OpenCode V2, Pi and Claude Code, and on the `om-memory-system memory` CLI. `memorize` is accepted as an alias.
- `recall` with an ID returns that record exactly. `recall` with text searches memorisations only and returns ranked matches with a confidence score.
- Memorisations stay out of every automatic path: per-prompt recall, opening context, compaction and resume restore, capture context, the web memory chat, normal `search` and `list`, the Memories page, duplicate removal and retention cleanup.
- New global setting `memorisationRepeat` (`add` or `replace`, default `add`). It decides what happens when the same session is memorised again.
- New `omms-remember` skill shipped with the plugin on every host, adapted from the user's `s-handoff` skill. It writes the snapshot, saves it with `memorise` and reports the ID.
- New **Memorisation** page in the web app with the list, recall search, copy ID, delete, the repeat setting and the size cap. English, Chinese and Arabic strings.

## Capabilities

### New Capabilities

- `memorisation`: saving, storing, recalling and isolating memorisation records through the `memory` tool and the CLI on every host, plus the repeat setting.
- `web-memorisation`: the Memorisation page in the web app.

### Modified Capabilities

- `omms-skill`: OMMS ships a second skill, `omms-remember`, on every host, and the `omms-memory` skill tells agents to use `recall` for "what were we going to do" questions.

## Impact

- Storage and search: `src/services/client.ts`, `src/services/turso/vector-search.ts`, `keyword-search.ts`, `exact-scan.ts`, `src/services/linked-search.ts`. A kind filter is added; the default hides memorisations.
- Maintenance paths: `deduplication-service.ts`, `cleanup-service.ts`, the AI tag backfill in `api-handlers.ts`, `src/core/capture.ts`.
- Tool and CLI: `src/core/memory-operations.ts`, `memory-tool-text.ts`, `src/v2/adapter.ts`, `src/index.ts` (V1 executor that V2 delegates to), `src/adapters/pi/extension.ts`, `hooks/omms-memory-tool.jsx`, `src/cli/memory-command.ts`.
- Config: `src/config.ts`, `config-template.ts`, `global-config-writer.ts`, `settings-snapshot.ts`.
- Web: `web/src/lib/routes.ts`, sidebar nav, `App.tsx`, a new page, i18n tables, new API routes in `src/services/memorisation-routes.ts`, registered in `src/services/web-route-modules.ts`.
- Skills: new `skills/omms-remember/`, an update to `skills/omms-memory/SKILL.md`, OpenCode skill registration in `package-skills.ts`.
- Docs: `docs/using-memory.md`, `docs/cli.md`, `docs/configuration.md`, `docs/web-ui-memory.md`, `docs/README.md`.
- No new dependency. No schema migration: the existing `type` column and `tags` carry the marker.
- Release: `feat:` (minor).
