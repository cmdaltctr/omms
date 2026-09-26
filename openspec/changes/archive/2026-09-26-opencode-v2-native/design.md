# Design

## Context

See proposal.md (Why). Current shape of the code:

- `src/plugin.ts` default-exports `{ ...OpenCodeMemPluginV2, id, server: OpenCodeMemPlugin }`. This is the dual V1/V2 shape the OpenCode v2 plugin migration guide recommends.
- `src/v2/plugin.ts` `setup(ctx)` builds the full V1 hook object (`OpenCodeMemPlugin` from `src/index.ts`) against a V1-shaped client shim (`src/v2/legacy-client.ts`). It then calls `registerV2Adapter(ctx, legacy)`.
- `src/v2/adapter.ts` replays V1 hooks. The `prompt` hook calls legacy `chat.message` and stashes any synthetic text part. The `context` hook pushes that text into `event.system`. `ctx.event.subscribe()` forwards every event to legacy `event`, including `session.compaction.ended`, which `toLegacyEvent` renames to `session.compacted`. That triggers the V1 path: `searchMemoriesBySessionID`, then `session.prompt({ noReply })`, which the shim turns into `ctx.session.synthetic(...)`, a durable synthetic message.
- Legacy `chat.message` injects only when `injectOn === "always"`, on the first user message, or on the first message after compaction. It uses `listMemories` (recency, `chatMessage.maxMemories`, default 3), not search.
- Pi's `buildPiRetrievalSection(prompt, directory, sessionId)` (`src/adapters/pi/retrieval.ts`) already does host-neutral semantic retrieval: `memoryClient.searchMemories`, `excludeCurrentSession` filtering, and `formatContextForPrompt`.
- On v2, structured output goes `setV2Client(legacyClient)` → shim `session.create` (synthetic id) → shim `session.prompt` → `ctx.generate.text` (sessionless, no tools). The V1 `config` hook (`applyStructuredOutputAgentConfig`) is never called on v2, and nothing on v2 needs it.
- `@opencode/plugin` is imported only with `import type` (`src/plugin.ts`, `src/v2/*`). The only runtime host import is `tool` from `@opencode-ai/plugin` in `src/index.ts` (V1 path).
- v2 hook types (`@opencode/plugin` 2.0.16, `dist/promise/session.d.ts`): `prompt` (`SessionPrompt`, with `prompt.text`, `sessionID`, `messageID`), `context` (`SessionContext`, with mutable `system: SystemPart[]`), and `compaction` (`SessionCompaction extends SessionContext`). `context` runs before each primary model request; `compaction` runs before the compaction request.
- Baseline: 96 test files, 589 passing and 0 failing (`scripts/run-tests-isolated.sh`).

## Goals / Non-Goals

**Goals:**

- The v2 path uses v2 hooks directly for retrieval and compaction and stops routing them through V1 `chat.message` / `session.compacted`.
- One retrieval implementation serves Pi and OpenCode v2.
- A mechanical, test-guarded rename to `omms` with explicit legacy fallbacks.

**Non-Goals:**

- Rewriting the V1 entry or removing V1 support.
- Replacing the legacy-client shim for the memory tool, idle capture, or profile learning. Those keep flowing through the shim and are only renamed.
- Changing on-disk storage, the tag-prefix format, or the `~/.opencode-mem` → `~/.omms` store migration.
- Publishing to npm (a separate change).

## Decisions

### D1. Move retrieval into a shared module

Move `buildPiRetrievalSection` to `src/core/retrieval.ts` as `buildRetrievalSection(prompt, directory, sessionId)`, plus a `wrapRetrievalSection(text)` that adds the `<omms-retrieval>` delimiters. Pi and v2 both import it, and `src/adapters/pi/retrieval.ts` is deleted. _Alternative:_ v2 imports from `adapters/pi/`. Rejected because the core would then depend on a host adapter, which violates the existing `pi-adapter-boundary` / `host-neutral-capture-boundary` test intent.

### D2. Search in `prompt`, apply in `context`

The v2 adapter computes the section once in `session.hook("prompt")`, keyed by `sessionID`, and pushes it into `event.system` in every `session.hook("context")` for that session until the next prompt replaces it. A prompt that yields no section clears the entry. _Alternative:_ search inside `context`. Rejected because `context` fires once per model step (tool loops), which would multiply embedding and search cost. The `prompt` hook runs before durable admission and gets the raw user text.

To keep a slow search from delaying admission, the search starts in `prompt` without being awaited (the promise is stored), and `context` awaits it with a bound (reuse `request-timeouts.ts`, about 2–3 s). On timeout or error the request goes out without a section. This keeps the "Retrieval fails" scenario non-blocking.

The legacy `chat.message` is no longer called from the v2 `prompt` hook. It still runs `userPromptManager.savePrompt`, which auto-capture needs, so the adapter calls a small extracted helper, `recordUserPrompt(sessionID, messageID, directory, text)`, that performs only that save plus the internal-session and structured-prompt guards. V1 `chat.message` calls the same helper, so its behaviour is unchanged.

### D3. Compaction through `session.hook("compaction")`

In the `compaction` hook, if `compaction.enabled`, fetch `searchMemoriesBySessionID(sessionID, projectTag, compaction.memoryLimit)`, format it with the existing `formatMemoriesForCompaction` (moved next to the retrieval helper), and store it as `restored[sessionID]`. Every later `context` for that session pushes the restored section after the retrieval section. It is replaced on the next compaction.

Because system parts are not durable, nothing is written to the transcript, which meets the spec's "no synthetic message" requirement. The v2 event bridge drops `session.compaction.ended` / `session.compacted` before calling legacy `event`, so the V1 prompt path never fires on v2. _Alternative:_ push memories into the compaction request's `system` so the summary absorbs them. Rejected as the only mechanism because summarisation can paraphrase or drop them. Re-adding them to later requests is deterministic.

### D4. No agent registration on v2

v2 structured output is already sessionless (`ctx.generate.text`). The adapter keeps not calling legacy `config`, and a test asserts that the shim `session.prompt` for a generated session calls `ctx.generate.text` and never `ctx.session.prompt` / `ctx.agent.transform`. _Alternative:_ port the agent through `ctx.agent.transform`. Rejected because it would add an unused, user-visible hidden agent.

### D5. Per-session state is bounded and released

The `contexts`, `restored`, and pending-search maps are capped (drop the oldest beyond 256 sessions) and cleared in the `setup` cleanup. They are also cleared per session on `session.deleted` events from the existing subscription.

### D6. Dependency placement

`@opencode/plugin` goes to `devDependencies` at `^2.0.16`, because runtime resolution never touches it. `tests/package-dependencies.test.ts` is updated, and a guard asserts that no non-type import of `@opencode/plugin` exists in `src/`. `@opencode-ai/plugin` stays in `dependencies` because it is a V1 runtime import.

### D7. Rename strategy and legacy allowlist

Mechanical rename of text and identifiers: `OpenCodeMemPlugin` → `OmmsPlugin`, `OpenCodeMemConfig` → `OmmsConfig`, `opencodeMemPiExtension` → `ommsPiExtension`, `Symbol.for("opencode-mem.*")` → `Symbol.for("omms.*")`, error prefixes `opencode-mem:` → `omms:`, `STRUCTURED_OUTPUT_AGENT` → `omms-structured`, metadata key `omms`, export `plugin.package` → `omms`, and web branding.

Compatibility points use a preferred-then-legacy list, following the existing `config.ts` global-config dual-read pattern:

| Surface                           | New                                | Legacy fallback                                                            |
| --------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| Project config                    | `.opencode/omms.jsonc`, `.json`    | `.opencode/opencode-mem.jsonc`, `.json`                                    |
| Project marker                    | `.omms-project`                    | `.opencode-mem-project`                                                    |
| Auth header                       | `x-omms-token`                     | `x-opencode-mem-token` (accepted in `auth-token.ts` and `web-api-auth.ts`) |
| Token file                        | `~/.omms/.auth-token` (mkdir 0700) | copy from `~/.opencode-mem/.auth-token` once                               |
| Token injected into HTML          | `window.__OMMS_TOKEN__`            | none (server and UI ship together)                                         |
| Capture session title             | `omms capture`                     | `opencode-mem capture` recognised                                          |
| Web `localStorage`                | `omms-theme`, `omms-lang`          | read the legacy key once, then write the new one                           |
| Global config, store dir, log env | unchanged legacy handling          | already present                                                            |

A guard test (`tests/legacy-name-guard.test.ts`) scans `src/` and `web/src/` for `opencode-mem|OpenCodeMem|OPENCODE_MEM`. It fails on any hit outside an allowlist of files and line patterns that implement these fallbacks: `legacy-migration.ts`, the legacy constants in `config.ts`, `tags.ts`, `auth-token.ts`, `web-api-auth.ts`, `internal-capture-sessions.ts`, `logger.ts`, `onnxruntime-resolve.ts` cache hints, and the web storage fallbacks.

## Risks / Trade-offs

- [v2 plugin API is beta and hook semantics may shift between 2.0.x releases] → Pin the dev type version to `^2.0.16`, keep hook usage to `prompt`, `context` and `compaction` (all in the migration guide), and add a manual verification task against the installed OpenCode (2.0.14) using `opencode api get /api/plugin`.
- [Per-prompt search adds latency to the first model request of each prompt] → Search starts at `prompt` time in parallel with admission, is bounded at `context`, and fails open.
- [The `prompt` hook may fire for commands or non-user prompt sources] → Skip retrieval when the prompt text is empty or matches the existing structured-summary / internal-session guards.
- [More system text on every step increases token use] → The section is bounded by existing limits (`maxMemories`, `maxProfileItems`, similarity threshold). The restored-session section is bounded by `compaction.memoryLimit`.
- [Renaming the auth header could break third-party scripts] → The legacy header stays accepted indefinitely, and the change is documented.
- [Test fixtures assert `opencode-mem` strings] → Update them with the rename. Run the isolated suite and compare against the 589-pass baseline.

## Migration Plan

No data migration. Existing users keep legacy config, marker, header and token working. New names apply to new writes and are preferred when both exist. Rollback means reverting the branch: legacy names were never removed, so an older build keeps reading everything it used before. The only new-only artifacts are `.omms-project`, `.opencode/omms.jsonc` and `~/.omms/.auth-token`, which older builds would ignore. The token regenerates, and a user would need to rename the marker and config back.

## Open Questions

- Should the V1 entry also move to per-prompt semantic retrieval (for example, a new `injectOn: "relevant"`)? This is deferred: V1 behaviour is out of scope here, and adding it later changes neither these specs nor the v2 design.
