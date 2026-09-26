# Proposal

## Why

OMMS loads in OpenCode v2 only through a thin bridge (`src/v2/adapter.ts`) that replays V1 hooks, so the OpenCode experience lags Pi: memory is injected only on the first message of a session and is the N most recent memories rather than the memories relevant to the current prompt. Post-compaction restore still rides the V1 `session.compacted` event and a synthetic prompt instead of the v2 `session.hook("compaction")` surface. With OpenCode v2 now the installed host (2.0.14 locally, `@opencode/plugin` 2.0.16 on npm) and the first npm release of `omms` pending, the v2 path needs to be native and the package must stop presenting itself as `opencode-mem`.

## What Changes

- OpenCode v2 retrieves memory **per user prompt** by semantic search, using the same shared retrieval as Pi (`buildPiRetrievalSection` promoted to a host-neutral helper), computed once in `session.hook("prompt")` and applied in `session.hook("context")` as a delimited system section. The first-message / recency-list behaviour remains for the V1 entrypoint only.
- OpenCode v2 restores the session's own memories after compaction through `session.hook("compaction")` plus the `context` hook, instead of the V1 `session.compacted` event and a synthetic `noReply` prompt. The v2 event bridge stops forwarding compaction events to the legacy handler.
- The v2 entrypoint does not register the V1 least-privilege `opencode-mem-structured` agent: on v2, structured output already runs through the sessionless `ctx.generate.text` path, which exposes no tools. This is made explicit and covered by a test.
- `@opencode/plugin` is bumped to `^2.0.16` and moved to `devDependencies` (every import is type-only). V1 support (`server` entry, OpenCode ≥ 1.18.29) is kept.
- All leftover `opencode-mem` names in code, web UI, tests, and docs are renamed to `omms`. Where a name is persisted on disk, sent over the wire, or written by users, the old name stays readable as a legacy fallback:
  - project config `.opencode/omms.jsonc` (legacy `.opencode/opencode-mem.jsonc` still read)
  - project marker `.omms-project` (legacy `.opencode-mem-project` still honoured)
  - API header `x-omms-token` (legacy `x-opencode-mem-token` still accepted)
  - auth token file `~/.omms/.auth-token` (legacy `~/.opencode-mem/.auth-token` adopted once)
  - internal capture session title `omms capture` (legacy title still recognised)
  - web UI `localStorage` keys `omms-theme` / `omms-lang` (legacy keys read once)
- **BREAKING (pre-release only)**: the exported `OpenCodeMemPlugin` symbol becomes `OmmsPlugin`, and the retrieval section tag changes from `<opencode-mem-retrieval>` to `<omms-retrieval>`. `omms` has not been published yet, so no aliases are kept.

## Capabilities

### New Capabilities

- `opencode-v2-adapter`: native OpenCode v2 plugin behaviour — per-prompt semantic retrieval, compaction restore through v2 hooks, no V1 agent-config dependency, v2 plugin identity, and coexistence with the V1 entry.
- `omms-naming`: `omms` is the only product name in code and user-facing surfaces, with defined legacy fallbacks for persisted, wire, and user-authored names.

### Modified Capabilities

- `host-neutral-memory-core`: "OpenCode behavior remains a compatibility surface" changes. The v2 adapter no longer only replays V1 behaviour; it gains native retrieval and compaction behaviour, while the V1 entry keeps today's behaviour.
- `pi-agent-adapter`: the retrieval section tag is renamed to `<omms-retrieval>`, and retrieval is built by the shared helper that OpenCode v2 also uses.

## Impact

- Code: `src/v2/adapter.ts`, `src/v2/plugin.ts`, `src/v2/legacy-client.ts`, `src/plugin.ts`, `src/index.ts`, `src/adapters/pi/{extension,retrieval,provider}.ts`, `src/config.ts`, `src/services/{tags,auth-token,web-api-auth,web-server,logger,embedding,memory-portability-service}.ts`, `src/services/ai/*`, `src/services/user-profile/ai-cleanup.ts`.
- Web UI: `web/src/lib/{api,theme}.ts`, `web/src/lib/i18n/*`.
- Tests: `tests/v2-plugin-adapter.test.ts`, loader contract tests, and every test asserting an `opencode-mem` string; a new guard test for leftover names.
- Docs: `README.md`, `docs/*.md`.
- Dependencies: `@opencode/plugin` → `^2.0.16` in `devDependencies`; lockfile update.
- Users: existing installs keep working unchanged; the new names are preferred, and legacy files, headers and markers stay readable.
