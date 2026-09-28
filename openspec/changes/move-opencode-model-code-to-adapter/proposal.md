# Proposal

## Why

OMMS's shared layers still hold OpenCode's own model code. `src/services/ai/` contains eight OpenCode-specific modules, and shared services call OpenCode models directly through them. This breaks the rule in CLAUDE.md and ADR-011 that shared code never depends on one host. It also goes against the existing requirement that the capture and profile pipeline depend on a provider-neutral port, not on OpenCode or Pi model APIs. Only the capture files are guarded by a boundary test today, which is how this went unnoticed.

## What Changes

- Move the OpenCode-specific modules from `src/services/ai/` into `src/adapters/opencode/`:
  - `opencode-provider.ts`, `opencode-sdk-client.ts`, `opencode-provider-loader.ts`, `opencode-host-config.ts`, `opencode-import-models.ts`, `opencode-diagnostics.ts`, and `profile-llm-client.ts`
  - `internal-capture-sessions.ts`, except the list of internal session titles. The OpenCode history reader needs that list, so it moves to `src/importer/`.
- Move OpenCode's profile learning loop, `src/services/user-memory-learning.ts`, which takes OpenCode's `PluginInput`, into `src/adapters/opencode/`.
- Change `user-profile-manager.ts` and `ai-cleanup.ts` in `src/services/user-profile/` to call a model through the existing `ModelPort` (`src/core/profile-analysis.ts`), which the host passes in. They no longer resolve or call OpenCode models themselves.
- Let the OpenCode adapter register its import models with the importer, the same way it registers its backfill models today (`registerHostBackfillModels`). `web-import-jobs.ts` and `settings-health.ts` then use the registered models instead of importing OpenCode code.
- Move host model listing for the Settings page (`src/services/settings-models.ts`) into `src/importer/`. The importer already holds the code that reads host data without the host running.
- Extend the boundary tests:
  - No file in `src/core/` or `src/services/` imports `@opencode-ai/*` or `@earendil-works/*`, statically or dynamically, or any adapter.
  - No file in `src/importer/` imports an adapter. The importer loads host SDKs only with dynamic `import()`, and only in its named reader modules.
- No user-visible behaviour changes. Capture, profile learning, AI cleanup, imports, backfills, and the Settings page work as before on both hosts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-neutral-memory-core`: the requirement "Provider-specific extraction is behind a narrow port" gains an enforceable rule. Shared code does not import host SDKs or adapter modules, and a boundary test checks every shared file.

## Impact

- **Code:** `src/services/ai/` (eight modules move out), `src/services/user-memory-learning.ts` (moves), `src/services/user-profile/user-profile-manager.ts` and `ai-cleanup.ts` (take a `ModelPort`), `src/services/settings-models.ts` (moves to `src/importer/`), `src/importer/web-import-jobs.ts`, `settings-health.ts`, `opencode-reader.ts`, `src/index.ts`, `src/v2/plugin.ts`, and `src/adapters/opencode/*` (new homes and import paths).
- **Tests:** the three boundary tests, plus the existing tests that mock the moved modules by path (`mock.module`), which need their paths updated.
- **Docs:** `docs/shared-core.md`, `docs/opencode-adapter.md`, and CLAUDE.md's architecture table.
- **Risk:** OpenCode live capture, profile learning, and AI cleanup are rewired. The existing OpenCode capture, profile, and v2 plugin tests, plus a manual check in OpenCode, cover this.
- **No data, config, or API change.** No release note beyond a refactor entry.
