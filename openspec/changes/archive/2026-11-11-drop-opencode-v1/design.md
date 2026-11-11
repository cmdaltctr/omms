# Design: drop-opencode-v1

## Context

See proposal.md for the motivation. This section records the current code and the evidence behind each decision.

### How V2 runs today

- `src/plugin.ts` default-exports `{ ...OmmsPluginV2, id, server: OmmsPlugin }`. `package.json` exports `.`, `./server` and `./v2`; `.` and `./server` both point at `dist/plugin.js`.
- `src/v2/plugin.ts` `setup` builds a V1-shaped client over the V2 context (`createLegacyClient`, `src/v2/legacy-client.ts`), calls the V1 plugin function `OmmsPlugin` (`src/index.ts:268`) with it, and passes the returned hook object to `registerV2Adapter` as `legacy`.
- `src/v2/adapter.ts` uses four parts of `legacy`:

| Shimmed call                                                              | Where                | What it does on V2 today                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.tool.memory` / `legacy.tool.skills` `.description` and `.execute` | `adapter.ts:239-261` | Registers both tools with `ctx.tool.transform`. The V2 JSON schemas come from `memoryInput` and `SKILLS_TOOL_INPUT_SCHEMA`; the V1 zod args are not used.                                                                       |
| `legacy["chat.params"]`                                                   | `adapter.ts:385-390` | Stores the request model on the recorded prompt row when the host model is `inherit` (`index.ts:636-649`).                                                                                                                      |
| `legacy.event`                                                            | `adapter.ts:403-419` | Forwards V2 events (mapped by `toLegacyEvent`) to `index.ts:658`. Only `session.created` (retry drain) and `session.idle` (capture, profile learning, cleanup) do work. Compaction events are skipped (`adapter.ts:76`, `409`). |
| `legacy.dispose`                                                          | `adapter.ts:432`     | Removes the signal handlers and closes the memory client (`index.ts:508-518`).                                                                                                                                                  |

- The body of `OmmsPlugin` (`index.ts:268-514`) is startup work that V2 needs: config load, trace pruning, runtime record, login item, warm-up, model registration, provider list, backfill, the Turso ready gate, the web app start, and the shutdown handlers.

### V1-only code

These parts never run on V2:

- `config` hook (`index.ts:519-523`): the `omms-structured` agent, the import command and the skills path. V2 registers the command with `ctx.command.transform` (`adapter.ts:267-292`) and the skills with `ctx.skill.transform` (`adapter.ts:264`, `addPackageSkill`). V2 structured output uses `ctx.generate.text` and ignores the `agent` field (`legacy-client.ts:171-197`).
- `command.execute.before` (`index.ts:527-545`) and `latestUserMessageModel` (`import-command.ts:117`).
- `chat.message` (`index.ts:547-634`), its helper `buildRecentMemoriesSection` (`src/core/retrieval.ts:106`), and the settings `chatMessage.maxMemories`, `maxAgeDays` and `injectOn`. A search of `src/`, `web/src/` and `hooks/` finds no other reader of those three keys.
- `session.compacted` restore (`index.ts:699-773`) and `resolveSessionAgent` (`index.ts:79`).
- The V1 HTTP transport: `configureOpencodeHostTransport` (`index.ts:228`), `opencode-host-config.ts`, `createV2Client` and the host-fetch state in `opencode-provider.ts`, and the lazy `@opencode-ai/sdk/v2/client` loader in `opencode-sdk-client.ts`. On V2, `getHostClientConfig` sees an in-process client, so `createV2Client` is not called, and `v2/plugin.ts:91-92` then sets the legacy client as the provider client.

### Installed versions

- `@opencode/plugin` 2.0.16 (dev dependency). Its `Context` has `tool.transform`, `command.transform`, `skill.transform`, `event.subscribe`, `session.hook` with `prompt`, `context` and `compaction`, `session.get`, `session.synthetic`, `generate`, and `model`. `Plugin.setup` may return a `Cleanup`. The design uses only these names.
- Source of truth for V2 API shapes: the installed `@opencode/client` 2.0.16 types (`dist/effect/api/api.d.ts`). They give `generate.text({ prompt, model? })` → `{ text }`, `session.interrupt` → `{ interrupted }`, `model.list()` → `{ data: Model.Info[] }`, and `session.context({ sessionID })` → session messages. The OpenCode plugin docs (Context7 `/anomalyco/opencode/v2.1.2`, `build/plugins/index.mdx`) show the same methods but simpler return types (`generate.text` as a string, `interrupt` as `void`). Code follows the installed types. The live check on OpenCode 2.2.6 confirms each shape at run time.
- OpenCode 2.2.6 is installed for the live check.

### OpenCode database (read-only checks, 10 November 2026)

Checks used `sqlite3 -readonly ~/.local/share/opencode/opencode.db`.

| Check                                                         | Result                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows: `session` / `session_v2`                                | 1006 / 1199                                                                                                                                                                           |
| Rows: `message` / `session_message` / `part` / `session_part` | 43125 / 50046 / 194087 / 0                                                                                                                                                            |
| V1 session ids also in `session_v2`                           | 1006 of 1006                                                                                                                                                                          |
| `session_v2` ids not in `session`                             | 193, created 27 September to 4 November 2026                                                                                                                                          |
| Same `directory`, `project_id`, `parent_id` for shared ids    | 1006 of 1006                                                                                                                                                                          |
| V1 message ids also in `session_message`, same `time_created` | 42465 of 43125                                                                                                                                                                        |
| V1 user messages missing as V2 `user` rows                    | 338: 219 absent, 66 `synthetic`, 53 `compaction`. None of the 219 has a non-synthetic text part.                                                                                      |
| `session_message.type`                                        | `assistant` 44363, `user` 3570, `synthetic` 1330, `idle` 496, `system` 119, `compaction` 64, `agent-switched` 52, `model-switched` 27, `location-switched` 25                         |
| V2 message data                                               | `user`: `text`, `files`, `agents`, `skills`, `time`. `assistant`: `content[]` of `text`, `reasoning`, `tool` (`name`, `state.status`, `state.input`, `state.content`, `state.error`). |
| `session_v2`: children / top level / OMMS titles              | 592 / 607 / 9                                                                                                                                                                         |

`session_part` is empty: OpenCode 2.x keeps message content inside `session_message.data`.

Import ledger (`~/.omms/data/import-ledger.db`, read-only): 7356 OpenCode rows that are imported or skipped, in 400 sessions, all from the default database. All 400 session ids and all 7356 user message ids exist as V2 rows of type `user`. Only 2452 of the 7356 last-answer ids still exist, in either table set. The other 4904 are gone from both `message` and `session_message`.

## Goals / Non-Goals

**Goals:**

- OpenCode V1 cannot load OMMS, and no V1 hook code remains.
- Every OpenCode V2 capability keeps working, proved by tests that run through the V2 adapter.
- No OpenCode code calls a V1-shaped client. `legacy-client.ts` is gone, and the package has no `@opencode-ai/*` dependency.
- The importer and backfill see V2-only sessions, and a rerun does not import V1-era units again.

**Non-Goals:**

- The host registry refactor named in `AGENTS.md`.
- Changes to Pi or Claude Code behaviour.
- The 8 GB snapshot copy that the importer makes when a WAL exists. It is existing behaviour.

## Decisions

### 1. Delete the V1 plugin object and move what V2 needs into V2 modules

Each shimmed call gets a native replacement. The new modules stay under 500 lines and follow the layer rules (`src/v2/` may use the V2 context; `src/core/` and `src/services/` stay host-free).

| Shimmed call                                       | Replacement                                                                               | New home                                                                           | Parity tests                                                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OmmsPlugin` startup body                          | `startOpencodeRuntime(ctx, client)` returns `dispose`                                     | `src/v2/startup.ts`                                                                | Port `opencode-web-ensure`, `opencode-trace-startup`, `opencode-runtime-registration`, `opencode-backfill-startup`, `v2-cache-cleanup` to call `OmmsPluginV2.setup` |
| `legacy.tool.memory`                               | `ctx.tool.transform` with a direct executor over `executeMemoryOperation`                 | `src/v2/tools.ts`; `src/adapters/opencode/memory-tool.ts` becomes a plain executor | Port `tool-scope`, `memory-portability-tool`, `opencode-v2-memory-session-id`, `profile-tool-runtime`, `memory-space-tool-parity`                                   |
| `legacy.tool.skills`                               | Same, over the shared skills operation                                                    | `src/v2/tools.ts`; `skills-tool.ts` becomes a plain executor                       | Port `opencode-skills-tool`                                                                                                                                         |
| `legacy["chat.params"]`                            | `recordPromptModel(messageID, model)` called in the `context` hook                        | `src/adapters/opencode/prompt-model.ts`                                            | New case in `v2-plugin-adapter`                                                                                                                                     |
| `legacy.event` (`session.created`, `session.idle`) | `handleOpencodeSessionEvent(event)` called from the existing `ctx.event.subscribe()` loop | `src/v2/session-events.ts`                                                         | New `v2-session-events` test: idle runs capture after 10 s, skill-only path, created starts the drain, internal sessions skipped                                    |
| `legacy.dispose`                                   | The `dispose` from `startOpencodeRuntime`, called by the cleanup that `setup` returns     | `src/v2/adapter.ts`                                                                | Existing unload case in `v2-plugin-adapter`                                                                                                                         |

`registerV2Adapter(ctx, legacy, memory)` becomes `registerV2Adapter(ctx, deps, memory)`, where `deps` holds the tool executors, `recordPromptModel`, the event handler and `dispose`. Tests pass fakes for `deps` the same way they pass a fake `legacy` today.

Alternative considered: keep `src/index.ts` as an internal, unexported module and delete only its V1 hooks. It is the smaller change, but V2 would still run through a V1 hook object, which the user rejected. The plan keeps the V2 runtime order the same: startup first, then the host client is set, then adapter registration. Until decision 6 lands, the host client is `setV2Client(legacyClient)`; after it, `setOpencodeHost(ctx)`.

### 2. Remove the V1 entry points

- `src/plugin.ts` default-exports the V2 plugin only, with no `server` property and no `OmmsPlugin` export.
- `package.json` drops the `./server` export. `.` and `./v2` stay.
- `tests/plugin-loader-contract.test.ts` asserts that `server` and `./server` are absent.
- `tests/plugin-bundle-boundary.test.ts` keeps building `dist/plugin.js` and `dist/v2/plugin.js`. Its provider-loader case drops the `createV2Client` check.

### 3. Remove the V1 HTTP transport and the `@opencode-ai/plugin` dependency

`configureOpencodeHostTransport` is the only production caller of `createV2Client` and the host-fetch setters, so they go with it, with `opencode-host-config.ts` and the lazy SDK loader in `opencode-sdk-client.ts`. A grep in task 3.6 confirms no other caller first. The `agent: STRUCTURED_OUTPUT_AGENT` field leaves the structured-output request body, because V2 ignores it.

`memory-tool.ts` and `skills-tool.ts` stop using the `tool()` helper from `@opencode-ai/plugin`. `profile-learning.ts` and `auto-capture-host.ts` replace `PluginInput` with a local type `{ client, directory }`. `@opencode-ai/plugin` then leaves `dependencies`.

### 4. Remove the three `chatMessage` settings and ignore old keys silently

Remove `maxMemories`, `maxAgeDays` and `injectOn` from the `chatMessage` type, `DEFAULTS` and the parsed result in `src/config.ts`, the `chatMessage.maxMemories` rule in `src/utils/memory-limits.ts`, the allowlist entry in `src/services/global-config-writer.ts`, the template comment in `src/config-template.ts`, and the row in `web/src/lib/memory-controls.ts` and its translations.

OMMS ignores the old keys with no log line and no migration code. The user confirmed a clean break on 11 November 2026: OMMS has no other users, so no compatibility path is needed. Reasons:

- `src/config.ts` has no unknown-key warning for any setting, so silence matches how every other unused key behaves.
- `refreshConfigIfChanged` reloads the config many times per process. A warning would repeat, or would need new state to log once.
- The keys are inert. They cannot change behaviour, so a warning gives the user nothing to act on. ADR 048 and the changelog tell users they may delete them.

The shallow merge stays correct. The loader still reads `chatMessage.enabled` and `chatMessage.excludeCurrentSession` from the effective object, and a project `chatMessage` object still replaces the global one. `nestedSetting` in `settings-snapshot.ts` stays, because `compaction.enabled` uses it. After the change no memory-limit rule has a nested path, so the `limitRule.path.length > 1` branch is unused. Remove it only if the type checker or the linter flags it.

### 5. Importer: read V2 tables first, V1 only for ids V2 lacks

- `validateSchema` accepts a database with `session_v2` and `session_message`, or with the V1 tables, or both. With neither, it fails with an error that names the missing tables. The error text drops "V1".
- Sessions: `session_v2` rows, plus V1 `session` rows whose id has no `session_v2` row. On the live database the V1 part adds 0 sessions. It still covers older copies passed with `--db` (for example backups made before the upgrade) and an incomplete migration.
- Filters on V2 rows: `parent_id IS NULL` for top level, the same title filter for OMMS sessions (`title` is nullable in `session_v2`), and the same `--since` and `--until` checks on the user message time. Counts for child and top-level sessions cover both sets without double counting.
- Units on V2 rows follow the spec "V2 messages map to work units". `synthetic` and `compaction` end the current unit, which is what the V1 reader did for a user message with no plain text. Tool calls reuse `opencodeToolOutcome`, `opencodeMemorise` and `readToolPath`, which already read V2 `state.content` (`src/core/tool-outcome.ts:34`).
- Live capture does not read this database. `src/adapters/opencode/` reads messages through the plugin context only.

Alternative considered: V2 tables only. The overlap check supports it for this database, but it would break `--db` on a pre-upgrade copy. The union costs one `NOT EXISTS` clause.

### 6. Port the `legacy-client.ts` users to the V2 context in this change

`legacy-client.ts` wraps the V2 context in the V1 SDK client shape (`client.session.messages`, `client.session.create/prompt/delete/abort`, `client.provider.list`, `{ data }` results, V1 `info` and `parts`). It calls only V2 APIs, but every OpenCode module still reads V1 shapes through it. The user chose to remove it in this change, so the V2-only release has no V1-shaped layer.

Measured scope (grep on 11 November 2026): about 60 source lines in 12 files use the V1 shape. `opencode-provider.ts` 23, `opencode-sdk-client.ts` 19 (deleted by decision 3), `profile-model.ts` 13, `src/importer/settings-models.ts` 8, and 2 to 5 lines each in `tui-recall.ts`, `profile-llm-client.ts`, `conversation.ts`, `backfill-startup.ts`, `auto-capture-summary.ts`, `auto-capture-host.ts`, `profile-learning.ts`, `import-command.ts` and `opencode-import-models.ts`. The earlier figure of 1,700 lines counted whole files. 13 test files build a fake V1 client and change to a fake V2 context. `tests/v2-legacy-client.test.ts` is replaced by a test for the new host module.

| V1-shaped call through the facade                               | V2 replacement                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.create` + `session.prompt` (format) + `session.delete` | One `ctx.generate.text({ prompt, model })` call. Parse the JSON reply as `parseJson` does today. No synthetic session id, no create, abort or delete. |
| `session.abort` on a generated session                          | Removed. A timeout drops the pending `generate.text` result, as the facade does today.                                                                |
| `session.messages`                                              | `ctx.session.context({ sessionID })`, read as V2 messages (`user`, `synthetic`, `assistant` with `content[]`).                                        |
| `session.get`                                                   | `ctx.session.get({ sessionID })`.                                                                                                                     |
| `session.prompt` with `noReply` / plain                         | `ctx.session.synthetic(...)` / `ctx.session.prompt({ ..., delivery: "queue" })`.                                                                      |
| `provider.list`                                                 | `ctx.model.list()`, grouped by `providerID` in the caller.                                                                                            |

Design rules:

- One narrow port type, `OpencodeHost`, in `src/adapters/opencode/opencode-host.ts`. It is a `Pick` of the V2 `Context` (`session`, `generate`, `model`), set once in `setup` (`setOpencodeHost(ctx)`). It replaces `setV2Client`/`getV2Client` and the `OpencodeClient` type. It registers with `resettable()` only if it holds a store handle; it does not, so it needs no reset.
- A pure mapper turns V2 session messages into the conversation turns that capture and profile learning read today. It lives in `src/adapters/opencode/`. The importer's V2 unit builder (decision 5) reads `session_message.data` from SQLite, which may differ from the plugin message shape; share code with it only where the shapes match.
- `src/importer/settings-models.ts` must not import `src/adapters/*`. It takes a `listModels()` function instead of an `OpencodeClient`.
- `toLegacyEvent` and `eventBelongsToLocation` move into `src/v2/session-events.ts` with V2 names.
- `markInProcessClient`, `isInProcessClient` and `in-process-client.ts` go, because only the V1 transport check read them.
- `profile-learning.ts` (832 lines) and `opencode-provider.ts` (641 lines) are on the file-size ceiling list. They may shrink, never grow.

Order: this port runs after the V1 hooks are deleted and their tests pass (tasks 3.12 to 3.18), so a failure points at one step. Each moved call site gets a test through a fake V2 context that fails on the old code first.

### 7. Ledger: match OpenCode units by session and user message

Today an OpenCode unit counts as handled only when its exact key `opencode:<session>:<user message>:<last answer>` is in the ledger. The ledger evidence shows that 4904 of 7356 last-answer ids no longer exist, so a rerun cannot match those units by exact key, with the V1 reader or the V2 reader. The V2 reader would also give some units a different last answer where V1 had a synthetic-only user message (219 messages in 11 sessions).

For the OpenCode host only, the importer treats a unit as handled when the ledger has an imported or skipped row whose key starts with `opencode:<session>:<user message>:`. The lookup uses the existing `session_id` index. Pi and Claude Code keep exact-key matching. A new memory still gets the full key, so crash reconciliation by import identity does not change.

Bug score: likelihood 7 (every rerun or backfill over this database), impact 5 (duplicate memories and profile prompts, recoverable by hand), product 35. Fix now.

### 8. Remove `@opencode-ai/sdk`

After decisions 3 and 6, no source file imports `@opencode-ai/sdk`: the lazy runtime loader goes with decision 3, and the `OpencodeClient` type goes with decision 6. Remove the package from `dependencies` and do not add it to `devDependencies`. The published entry types (`dist/plugin.d.ts`, `dist/v2/plugin.d.ts`) already import only `@opencode/plugin`, and `check:package` passes with that today. Task 3.18 greps `src/`, `tests/` and `dist/` for `@opencode-ai/` and runs `bun run check:package` to prove it.

### 9. Live-check findings fixed in this change (11 November 2026)

- **Untagged memories were capped below the threshold.** The 60/40 content and tags blend gave a memory with no tags at most 0.6 of its content match. "WAL mode" scored 0.498 against a 0.5 threshold, on this branch and on 5.10.1. Search now scores an untagged memory by content alone, as it already does for memorisations. Bug score: likelihood 6, impact 4, product 24. See TDR-079.
- **`inherit` needed `model.json`.** Calls without a prompt model read only OpenCode's `model.json`, which headless OpenCode never writes. The `context` hook now remembers the latest request's model, and `inherit` uses it before `model.json`. Bug score: likelihood 6, impact 5, product 30. See TDR-080.
- **Verify warnings.** The Settings model list now groups by provider in first-seen order, a test proves setup adds no agent, the `chatMessage` template comment no longer names a V1-only behaviour, and `package.json` no longer lists V1 hook names under `opencode.hooks`.

## Risks / Trade-offs

- [A V1 user upgrades and loses memory in OpenCode] → `feat!:` makes a major release. ADR 048, the changelog and `docs/opencode-adapter.md` say how to move to V2.
- [The startup move changes the order of startup steps on V2] → Keep the order of `OmmsPlugin` (`index.ts:268-465`). Port the existing startup tests before the move, and check that they pass against the old code first.
- [`@opencode/plugin` 2.0.16 types differ from OpenCode 2.2.6 at run time] → Use only APIs the adapter already calls today, and check them in the live test.
- [The prefix ledger match hides a unit that gained new turns after its import] → OpenCode adds new turns as new user messages, which get new keys. A unit grows only when an old prompt gets more answers later, which is rare. Accept.
- [An old project config sets only `chatMessage.maxMemories`] → The project object still replaces the global one, so `enabled` falls back to its default `true`. This is today's behaviour. Document it in `docs/configuration.md`.
- [`index.ts` deletion breaks tests that import it] → Task group 1 lists each one and ports it first.

## Migration Plan

1. Release as a major version through release-please (`feat!:` with a `BREAKING CHANGE:` footer).
2. Users on OpenCode V2 need no action. The next import or backfill picks up V2-only sessions.
3. Users on OpenCode V1 upgrade OpenCode, or pin the last OMMS major.
4. Rollback: revert the commit and release a patch on the previous major. The ledger prefix match writes no new data, so a rollback leaves the ledger valid.

## Open Questions

None. Answered on 11 November 2026:

- Port `legacy-client.ts` users in this change (decision 6), which also removes `@opencode-ai/sdk` (decision 8).
- Old `chatMessage` keys: clean break, ignored silently with no warning and no migration (decision 4).
