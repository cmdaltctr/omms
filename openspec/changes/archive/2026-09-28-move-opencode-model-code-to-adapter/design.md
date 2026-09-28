# Design

## Context

What calls the OpenCode-specific modules in `src/services/ai/` today:

| Module                         | Called from                                                                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opencode-provider.ts`         | `src/index.ts`, `adapters/opencode/user-prompt.ts`, `services/settings-models.ts`, `opencode-provider-loader.ts`                                                                                                                                                           |
| `opencode-provider-loader.ts`  | `src/index.ts`, `src/v2/plugin.ts`, `adapters/opencode/*`, `importer/web-import-jobs.ts`, `services/user-memory-learning.ts`, `services/user-profile/user-profile-manager.ts`, `services/user-profile/ai-cleanup.ts`, `profile-llm-client.ts`, `opencode-import-models.ts` |
| `opencode-import-models.ts`    | `importer/settings-health.ts`, `importer/web-import-jobs.ts`, `adapters/opencode/import-command.ts`, `adapters/opencode/backfill-models.ts`                                                                                                                                |
| `opencode-sdk-client.ts`       | `opencode-provider.ts`                                                                                                                                                                                                                                                     |
| `opencode-diagnostics.ts`      | `opencode-provider.ts`                                                                                                                                                                                                                                                     |
| `opencode-host-config.ts`      | `src/index.ts`                                                                                                                                                                                                                                                             |
| `internal-capture-sessions.ts` | `src/index.ts`, `importer/opencode-reader.ts`, `opencode-provider.ts`                                                                                                                                                                                                      |
| `profile-llm-client.ts`        | `services/user-memory-learning.ts`, `services/user-profile/user-profile-manager.ts`                                                                                                                                                                                        |

- `src/services/user-memory-learning.ts` is OpenCode's profile learning loop. It takes OpenCode's `PluginInput`, and only `src/index.ts` calls it.
- Pi learns the profile through the shared `analyzeProfile` in `src/core/profile-analysis.ts`, with a `ModelPort` built by `adapters/pi/profile.ts`.
- `user-profile-manager.ts` and `ai-cleanup.ts` check `resolveOpencodeHostModel(CONFIG)` and then call OpenCode's `generateStructuredOutput` themselves.
- `src/importer/backfill-controls.ts` already has a registry, `registerHostBackfillModels`, that the OpenCode adapter fills at start-up.
- The boundary tests check the capture files for host SDKs, and check `src/core`, `src/services`, `src/types`, and `src/importer` for adapter paths. They do not check the rest of `src/services` for SDK imports.

## Goals / Non-Goals

**Goals:**

- No file in `src/core/`, `src/services/`, or `src/types/` imports a host SDK or an adapter.
- Shared profile code calls models only through `ModelPort`.
- A boundary test enforces this for every shared file.
- Behaviour on both hosts stays exactly the same.

**Non-Goals:**

- Merging OpenCode's profile learning loop into the shared `analyzeProfile` path that Pi uses. It is worth doing, but it changes behaviour and needs its own change.
- Changing the live-model rule, capture diagnostics, or any config, API, or data format.
- Changing how the OpenCode V1 and V2 plugins load.

## Decisions

### D1. The OpenCode modules move into the OpenCode adapter unchanged

`opencode-provider.ts`, `opencode-sdk-client.ts`, `opencode-provider-loader.ts`, `opencode-host-config.ts`, `opencode-import-models.ts`, `opencode-diagnostics.ts`, `profile-llm-client.ts`, and `user-memory-learning.ts` move to `src/adapters/opencode/` with `git mv`. Only their import paths change. This keeps the history of each file and makes the review a list of path changes.

### D2. Internal session titles move to the importer

`INTERNAL_CAPTURE_SESSION_TITLES` and `isInternalCaptureSessionTitle` describe OpenCode's history format: the titles omms gives its own capture sessions. The OpenCode history reader needs them without OpenCode running. They move to `src/importer/opencode-internal-sessions.ts`. The in-process tracking of live internal sessions (`isTrackedInternalCaptureSession`) moves with the adapter.

### D3. Shared profile code uses a registered ModelPort

A host registers a `ModelPort` factory with `registerHostProfileModel` in `src/services/user-profile/profile-model.ts`. `user-profile-manager.ts` and `ai-cleanup.ts` call `resolveHostProfileModel()`. When it returns a port, they call it with the same prompt and schema as now. When it returns null, they use the external API as today. The OpenCode adapter registers `adaptOpencodeProfileModel` at plugin start. Pi registers nothing, so Pi behaviour does not change. The standalone web app registers nothing, so its cleanup uses the external API, as today.

`ModelPort` gains an optional `completeStructured(system, user, schema)`. OpenCode maps it to its structured output, as before. A port without it falls back to `complete` and parses the reply with the schema.

Why a registration and not an argument: an argument would have to pass through `mergeProfileData`, `mergeItems`, and `evolveAndUpdate`, and through callers in `src/core/memory-operations.ts` and the web server. The registration keeps the same routing in every process with less change. It lives in services, because `src/services/` cannot import `src/importer/`.

Alternative: move both files into the adapter. Rejected, because Pi and the web server use them too.

### D4. The importer receives OpenCode's models by registration

`src/importer/backfill-controls.ts` keeps `registerHostBackfillModels` and adds `registerOpencodeHostModels`. The OpenCode adapter registers one object with `isProviderConnected`, `createImportModels`, and `listSettingsModels`. `web-import-jobs.ts`, `settings-health.ts`, and `settings-models.ts` use it instead of importing adapter code. With nothing registered, as in the standalone web app, they report that OpenCode models are unavailable, with the same messages as now. Pi registers no import models, because web imports use only OpenCode or external models. The profile port is not in this registry (see D3).

Alternative: let the importer import the adapter dynamically. Rejected by ADR-011.

### D5. Model listing for the Settings page moves to the importer

`settings-models.ts` lists each host's signed-in models for the page. It reads host data without the host running, which is the importer's role (ADR-011). It moves to `src/importer/settings-models.ts`. It loads the Pi SDK dynamically, as today. It gets the OpenCode model list from the D4 registration.

### D6. One boundary test covers every shared file

`tests/pi-adapter-boundary.test.ts` gains a check that walks every `.ts` file under `src/core`, `src/services`, and `src/types`. It fails on any `@opencode-ai/` or `@earendil-works/` specifier in an `import`, `import type`, `export … from`, or `import()` call. For `src/importer`, it allows host SDKs only in a named list of reader modules (`session-loader.ts`, `import-readiness.ts`, `settings-models.ts`). Only `session-loader.ts` may import its SDK statically, because `run-import.ts` loads it through `import()`. The test also fails if any file imports `session-loader.ts` statically. The failure message names each file.

## Risks / Trade-offs

- [OpenCode capture or profile learning breaks after the move] → The moves are path-only (D1). The existing OpenCode capture, profile learning, V2 plugin, and bundle-boundary tests must pass unchanged, apart from mock paths. A manual check in OpenCode confirms one capture and one profile run.
- [Tests mock the moved modules by path with `mock.module`] → Update each mock path in the same commit as the move. A mock of the old path fails silently, so search the tests for every old path.
- [The V1 plugin bundle grows or loads the SDK too early] → `tests/plugin-bundle-boundary.test.ts` checks it. Keep every SDK load behind dynamic `import()`.
- [Two profile learning loops stay] → This change leaves that as it is, by design (Non-Goals). Record it as a follow-up.
