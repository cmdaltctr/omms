# ADR-048: OMMS supports OpenCode V2 only

- **Date:** 2026-11-11
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Change:** [`drop-opencode-v1`](../../openspec/changes/drop-opencode-v1/proposal.md)

## Context

`AGENTS.md` already said that OMMS supports OpenCode V2 only. The code did not match. The package still exported a V1 plugin (`./server`), and the V2 plugin ran through a V1 plugin object (`src/index.ts`) that it wrapped as `legacy`. V1 hooks, V1-only settings and V1 tests stayed in the code. [ADR-047](047-memorisations-are-a-record-kind-in-the-memory-store.md) (decision 14) kept the V1 tool executor "because V2 wraps it".

OpenCode documents that V1 hooks do not run in V2, and that each V1 hook has a native V2 replacement.

Facts from the code that shape the decision:

- `src/v2/adapter.ts` used four parts of the V1 hook object: the `memory` and `skills` tools, `chat.params`, `event` and `dispose`. The startup work (config, warm-up, models, backfill, web app, shutdown) ran in the body of the V1 plugin function.
- These parts never ran under V2: the `config` hook, `command.execute.before`, `chat.message`, the `session.compacted` restore, and the V1 HTTP transport.
- The settings `chatMessage.maxMemories`, `chatMessage.maxAgeDays` and `chatMessage.injectOn` had no reader outside `chat.message`.
- `src/v2/legacy-client.ts` wrapped the V2 context in the V1 SDK client shape. About 60 source lines in 12 files read V1 shapes through it.

## Decision

1. **OpenCode code uses the V2 plugin API only.** `src/plugin.ts` default-exports the V2 plugin with no `server` property. `package.json` has no `./server` export. OpenCode V1 cannot load OMMS.
2. **The V1 plugin object is deleted.** The work that V2 needs moves into V2 modules: `src/v2/startup.ts` (startup and shutdown), `src/v2/tools.ts` (the `memory` and `skills` tools through `ctx.tool.transform`), `src/v2/session-events.ts` (idle capture, profile learning and the retry drain from `ctx.event.subscribe()`), and `src/adapters/opencode/prompt-model.ts` (the session model, recorded in the `context` hook).
3. **The V1-shaped client facade is deleted.** Structured output for capture and profile learning is one sessionless `ctx.generate.text` call. Messages come from `ctx.session.context`, and the model list from `ctx.model.list`. One narrow port, `OpencodeHost` (`src/adapters/opencode/opencode-host.ts`), holds `session`, `generate` and `model`.
4. **The package has no `@opencode-ai/*` dependency.** `@opencode-ai/plugin` and `@opencode-ai/sdk` leave `dependencies`. Types come from the `@opencode/plugin` dev dependency.
5. **The three V1-only `chatMessage` settings are removed.** OMMS ignores them in old config files, with no warning and no migration. `chatMessage.enabled` and `chatMessage.excludeCurrentSession` stay. A project `chatMessage` object still replaces the global one. The web **Memory limits** card has five rows.
6. **Notices go to the OpenCode log.** The V2 server plugin has no toast API.
7. **The release is a major version.** The commit is `feat!:` with a `BREAKING CHANGE:` footer. Users on OpenCode V1 upgrade OpenCode or stay on the last OMMS major.
8. **Tests for OpenCode run through the V2 adapter.** A test for a tool, a hook or an event calls the V2 plugin `setup` with a fake V2 context.

This ADR replaces decision 14 of ADR-047 for the V1 tool executor. That executor no longer exists.

The same change fixes the OpenCode history importer, which read only the V1 session tables. See [TDR-078](../tdr/078-opencode-importer-missed-v2-session-tables.md).

Without a V1 hook to report the session model, `"inherit"` follows the model of the latest model request the V2 `context` hook saw. See [TDR-080](../tdr/080-inherit-failed-without-opencode-model-json.md).

## Alternatives Considered

| Option                                                              | Rejected Because                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Keep `src/index.ts` as an internal module and delete only its hooks | V2 would still run through a V1 hook object, and V1-shaped tests would stay.                              |
| Keep `legacy-client.ts` and port its users in a later change        | The V2-only release would still carry a V1-shaped layer and two OpenCode packages.                        |
| Keep `@opencode-ai/sdk` as a runtime dependency                     | No source file imports it after the port. `check:package` passes without it.                              |
| Log one line when an old `chatMessage` key is found                 | The keys do nothing, so a warning gives the user no action. The config reloads often, so it would repeat. |
| Keep V1 working in parallel                                         | Every OpenCode feature would need two code paths. Pi parity work would double.                            |

## Consequences

### Positive

- One OpenCode code path. A tool, a hook or an event has one owner.
- No V1 hook code, V1 tests or V1 docs to keep in step with V2.
- A smaller package: two dependencies leave `dependencies`.
- Structured output creates no internal session, so capture no longer produces `omms capture` sessions.

### Negative

- An OpenCode V1 install stops loading OMMS after the upgrade. The user upgrades OpenCode or stays on the previous OMMS major.
- Old `chatMessage.maxMemories`, `maxAgeDays` and `injectOn` keys stay in config files and do nothing.
- A project config that holds only old `chatMessage` keys still replaces the global object, so `chatMessage.enabled` takes its default, `true`.
- The V2 server plugin shows no toasts. Capture and error notices appear in the OpenCode log.

### Neutral

- Claude Code and Pi behaviour does not change.
- The host registry refactor named in `AGENTS.md` stays a separate, unstarted change.

## References

- [ADR-047](047-memorisations-are-a-record-kind-in-the-memory-store.md)
- [TDR-078](../tdr/078-opencode-importer-missed-v2-session-tables.md)
- [TDR-079](../tdr/079-untagged-memories-scored-below-the-search-threshold.md): found in the live check for this change
- [TDR-080](../tdr/080-inherit-failed-without-opencode-model-json.md): found in the live check for this change
- [OpenCode adapter](../opencode-adapter.md)
- [Configuration: Memory injection](../configuration.md#memory-injection)
- `src/plugin.ts`, `src/v2/plugin.ts`, `src/v2/startup.ts`, `src/v2/tools.ts`, `src/v2/session-events.ts`, `src/adapters/opencode/opencode-host.ts`, `src/adapters/opencode/prompt-model.ts`
