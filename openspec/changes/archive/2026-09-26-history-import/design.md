# Design

## Context

See proposal.md for the motivation. Observed facts that shape the design:

- **OpenCode database** (`~/.local/share/opencode/opencode.db`, about 8 GB, the V1 schema restored from the old Mac). It has 1,006 sessions, 461 of them top-level; 545 are sub-agent children with a `parent_id`.
  - Tables: `session(id, project_id, parent_id, directory, title, time_created, …)`, `message(id, session_id, time_created, data JSON)` and `part(id, message_id, session_id, time_created, data JSON)`.
  - `message.data.role` is `user` or `assistant`. Part `type` counts: tool 47.9k, step-start/finish 39k each, reasoning 35k, text 24k, patch 8k, file 289, agent 73, compaction 59, subtask 5.
  - `project(id, worktree, …)` records each session's repository root, so most sessions from deleted worktrees resolve to an existing repository. About 26 top-level sessions (Open Design app folders, temp folders, one repo not on this Mac) do not.
- **Reading safely:** `node:sqlite` (Node ≥ 22.13) opens `file:<path>?immutable=1` with `readOnly: true` while OpenCode is running. Verified: the top-level session count returns instantly. Immutable mode never writes the `-wal`/`-shm` files.
- **Pi importer to reuse:** `src/importer/importer.ts` (`importPiHistory`: filters, unit reports, `buildImportKey`, `findMemoryIdByImportId` for crash reconciliation) and `ledger.ts` (`PiImportLedger`, `import-ledger.db`, statuses in-progress/imported/skipped/failed). Units go through `captureConversation` (`src/core/capture.ts`) with a `CaptureSummaryProvider`.
- **Profile learning:**
  - Pi uses `createPiProfileAnalyzer(resolveModel)` and `performPiProfileLearning` (`src/adapters/pi/profile.ts`). These are prompt-in/JSON-out over a `complete(context)` model handle, persisted through `userProfileManager`.
  - OpenCode's `performUserProfileLearning` (`src/services/user-memory-learning.ts`) is tied to `PluginInput` and to the idle scheduler.
  - `userPromptManager` stores prompts (`savePrompt(sessionId, messageId, projectPath, content)`) with `countUnanalyzedForUserLearning` / `getPromptsForUserLearning` / `markAsUserLearningCaptured`.
- **External models without a host:** `AIProviderFactory.createProvider(type, config)` supports openai-chat, openai-responses, anthropic, minimax, google-gemini and orcarouter. It is driven by `memoryProvider`/`memoryModel`/`memoryApiUrl`/`memoryApiKey`. The maintainer's current config uses `opencodeProvider`/`opencodeModel` (host-only) and has no `memoryModel`, so the terminal command needs flags or new settings.
- **Capture bug:** `captureSummarySchema` requires `summary`, `type` and `tags`, so `{"type":"skip"}` fails. Observed live with `zai/glm-5.3`; a second attempt succeeded.

## Goals / Non-Goals

**Goals:**

- A single command replaces the three scripts, with AI-quality memories, idempotency, and no manual path lists for worktrees.
- Pi and OpenCode imports share one ledger, one unit pipeline and one profile step.
- Safe to run while OpenCode is open, and cheap to preview.

**Non-Goals:**

- Importing OpenCode V2 session storage (sessions created by OpenCode 2.x on this Mac). The restored V1 database holds all history up to 2026-09-19; later sessions are captured live.
- An in-OpenCode slash command (decided: terminal only).
- Changing live capture or the live profile scheduler, beyond the skip-parse fix.
- Deleting or rewriting the old Python scripts' repository.

## Decisions

### D1. Terminal entry point

- `package.json` gains `"bin": { "om-memory-system": "dist/cli/index.js" }`. `src/cli/index.ts` dispatches subcommands; `import-opencode-history` is the first. It uses `node:util` `parseArgs`, with no new dependency, and a `#!/usr/bin/env node` shebang.
- The CLI loads config the same way the plugin does (`initConfigWithLegacyMigration(cwd)`), so it uses the same store and the same legacy migration.
- It exits non-zero on fatal errors. A final summary prints counts per project and status.

_Alternative considered:_ a `bun` script inside the repo. Rejected, because users run the published package and `npx` needs no clone.

### D2. OpenCode reader (`src/importer/opencode-reader.ts`)

- Opens the database with `node:sqlite` (`file:…?immutable=1`, `readOnly: true`). The `--db` flag overrides the path.
- Walks top-level sessions ordered by `time_created`, applying filters in SQL where possible (`--since/--until/--session/--max-sessions`).
- Loads messages and parts one session at a time, so memory use stays bounded on an 8 GB database.
- Builds `CaptureConversation` windows: a user message plus the assistant messages that follow it, up to the next user message.
  - Assistant `text` parts become responses.
  - `tool` parts become `{name, input}`, with input truncated as live capture does.
  - `reasoning`, `step-*`, `patch`, `file` and `compaction` parts are dropped.
  - `subtask`/`agent` parts and delegated-task tool calls are kept as tool calls, which is how child-session work is represented. Child sessions are never walked.
- The user text is the concatenation of the user message's non-synthetic `text` parts. Synthetic parts (OpenCode or plugin injected, including old opencode-mem memory context) are excluded.

_Alternative considered:_ the libSQL client, which is already a dependency. Rejected, because its file URLs do not expose SQLite's `immutable` flag and a WAL database opened read-only can still create `-shm` files.

### D3. Project resolution

The order is: recorded `directory` if it exists, then `--map`, then `project.worktree` if it exists (skipping `/`), otherwise unresolved. The resolved directory goes to `getProjectTagInfo`, so worktrees of the same repository share its git-common identity. The dry-run report lists unresolved directories with session counts.

### D4. One importer core for both hosts

- Generalise `src/importer/importer.ts` to take a host-agnostic source: an async iterable of `{sessionId, directory, units[]}` plus the host label.
- `importPiHistory` becomes the Pi source plus that core. The new `importOpencodeHistory` is the OpenCode reader plus the same core.
- Rename `PiImportLedger` to `ImportLedger`, keeping a `PiImportLedger` alias, in the same `import-ledger.db`.
  - Keys are `opencode:<sessionId>:<userMsgId>:<lastAssistantMsgId>`.
  - Existing Pi keys (`pi:…`) are unchanged, so earlier Pi imports stay deduplicated.
- Provenance: `host=opencode`, `sourceType=history-import`, `hostSessionId`, `sourceEntryIds`, `sourceTimestamp`, `importId` = the key.

### D5. Profile steps, shared by both importers

- **Prompts:** during the memory pass, each unit's user prompt (non-empty, not internal per `isInternalPrompt`) is stored with `userPromptManager.savePrompt(sessionId, userMsgId, projectDir, text)`.
  - It is marked as already captured, so live auto-capture never reprocesses history.
  - It is left unanalysed for user learning.
  - Idempotency comes from a ledger row per prompt (`<key>#profile`), so reruns never add it twice.
  - With `--skip-memories`, the pass still walks units but only records prompts.
- **Build:** after the pass, loop while `countUnanalyzedForUserLearning() > 0`:
  1. take `getPromptsForUserLearning(batchSize)`, default 50, with `--profile-batch`
  2. analyse them with the host-neutral profile analyser
  3. create or update the profile through `userProfileManager`
  4. `markAsUserLearningCaptured`

  It stops after a batch fails twice and reports the remaining count, which a rerun resumes.

- The analyser moves from `src/adapters/pi/profile.ts` into `src/core/profile-analysis.ts`, over a `ModelPort = { provider, modelId, complete(systemPrompt, userPrompt): Promise<string> }`. Pi adapts `PiModelHandle` to it and the CLI adapts `AIProviderFactory`. `performPiProfileLearning` then delegates to it, so live Pi behaviour is unchanged.

### D6. Model selection

- **CLI:** the flags `--provider`, `--model`, `--api-url` and `--api-key-env` are merged over `memoryProvider`/`memoryModel`/`memoryApiUrl`/`memoryApiKey`. The key is resolved through the existing secret resolver, so `env://` and `file://` forms keep working.
  - A dry-run never needs a model.
  - A real run validates the model settings first and names what is missing.
  - The key is never printed; the report shows the provider and model only.
- **Pi:** `--model provider/id` is resolved with `ctx.modelRegistry.find`. Otherwise the importer uses the active model, as today.

### D7. Capture fix

- In `captureSummarySchema`, `summary` and `tags` default to `""` and `[]`. A refinement requires a non-empty `summary` unless `type` is `skip`, so a real memory can never be stored empty.
- `parseCaptureSummary` callers (the Pi provider and the OpenCode fallback) log `{provider, modelId, reply: first 500 chars}` when parsing fails.

### D8. Replacing the scripts

- `docs/opencode-history-import.md` covers usage, flags, cost, the old-script mapping (the three scripts map to the three steps) and troubleshooting.
- README and `docs/pi-history-import.md` get the new profile and `--model` options.
- The old scripts are not changed. The docs say they are superseded and do not work with omms.

## Risks / Trade-offs

- [**Cost:** about one model call per exchange, over hundreds of sessions] → The dry-run shows the exact count. Filters and a cheaper `--model` bound the spend, skips are terminal, and the ledger makes stopping and resuming free.
- [**`immutable=1` reads a snapshot that ignores WAL changes made while it is open**] → Only history is imported. A session still active during the import is picked up on the next run, because its later units have new keys.
- [**The OpenCode V1 schema could differ on other installs**] → The reader checks for the needed tables and columns first and stops with a clear message instead of misreading data.
- [**Profile quality from very old or noisy prompts**] → Prompts go through the same privacy filter and internal-prompt check. Batches are chronological, so the profile's newest state reflects recent habits. `--since` can limit history.
- [**Node's `node:sqlite` prints an ExperimentalWarning on some Node versions**] → The CLI suppresses that single warning and the docs require Node ≥ 22.14.
- [**Profile scheduler overlap:** a live OpenCode or Pi session may run profile learning at the same time] → Both use `userProfileManager.updateProfile`, which detects version conflicts. The CLI retries a conflicted batch once, then stops.

## Migration Plan

No data migration. The ledger schema is unchanged, apart from new key prefixes. Rollback is to revert the release, since imported memories and profile rows are ordinary data. Each import run can be undone:

- by tag: history-import memories carry `sourceType=history-import`
- by ledger: listing `import-ledger.db`

## Open Questions

- The default profile batch size (50) and the cap on prompts per batch (by bytes) may need tuning after the first real run. It can be changed without altering specs.
