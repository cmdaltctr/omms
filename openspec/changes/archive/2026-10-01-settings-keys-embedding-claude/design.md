## Context

See proposal.md for the reasons. Facts that shape the approach:

- **Embedding.** `src/services/embedding.ts` uses the server only when both `embeddingApiUrl` and `embeddingApiKey` are set. This is why the user's config holds the stand-in key `ollama`, copied from the old `~/.config/opencode/opencode-mem.jsonc`. The original opencode-mem supported the same two kinds: a built-in model and an OpenAI-compatible `/embeddings` server. Ollama (`/v1/embeddings`), llama.cpp `llama-server --embeddings` (`/v1/embeddings`), OpenRouter (`/api/v1/embeddings`), and OpenAI all fit the second kind.
- **Re-embed.** `MigrationService` already detects a vector-size mismatch per shard (`shard_metadata`) and re-embeds under each shard's write lock, through `/api/migration/detect` and `/api/migration/run`. The Memories page shows a banner for it. It reads the stored model name but compares only the size.
- **Tokens.** `webServerApiToken` is compared with `===` in `authorizeApiRequest`. `src/cli/web-command.ts` and the web server's own start probe send it to a running web app. Hosts and the Claude hook use the local token file `~/.omms/.auth-token`, not this key.
- **Settings plumbing.** `global-config-writer.ts` writes config keys with a revision check. `memory-key-source.ts` saves a pasted secret to `~/.config/omms/secrets/` and stores a `file://` reference. The page has a shared snapshot signal (`onSettingsSnapshot`).
- **Claude Code.** The snapshot already computes Claude Code readiness and the transcripts folder in use. `selectImportModel` never fills `path`, `provider`, or `model` in the diagnostics.

## Goals / Non-Goals

**Goals:**

- Change the embedder safely from the page, with a test before and a re-embed after.
- Manage API tokens and the browser password without editing files.
- Close the Claude Code gaps in Health and Diagnostics, and the stale Import label.

**Non-Goals:**

- No new embedding provider protocol. Only built-in models and OpenAI-compatible servers.
- No token scopes or per-route permissions. A token grants the same access as today's config token.
- No editing of `webServerHost` on the page.
- No backfill of old diagnostics rows.

## Decisions

1. **Embedding kind is derived, not a new key.** An empty `embeddingApiUrl` means built-in. The card's presets only fill the URL. The Keys card marks `embeddingApiKey` needed when the URL's host is not on this machine and the key is empty. A server on this machine never needs one.
   - Alternative: a new `embeddingApiKeyRequired` key set by the preset. Rejected: it adds state that can drift from the URL.
2. **Key optional for servers.** `embedding.ts` selects the server on `embeddingApiUrl` alone, and adds `Authorization` only when a key is set. A config that has both keeps its behaviour.
3. **Test route.** `POST /api/settings/embedding/test` takes the candidate kind, URL, model, and key source, builds a one-off embedder (not the shared instance), embeds a fixed sentence, and returns the size. The key is resolved on the server; a pasted key is not sent back.
4. **Apply route.** `POST /api/settings/embedding/apply` requires the revision, a candidate that matches the last passing test (the server keeps the test result for 10 minutes, keyed by a hash of the candidate), and loopback plus the local token. It writes `embeddingApiUrl`, `embeddingApiKey`, `embeddingModel`, and `embeddingDimensions` in one config write, reloads config, resets the shared embedding service, then starts `MigrationService.migrateToNewModel("re-embed")` in the background. It answers `202` with a run id. Progress is read from `GET /api/settings/embedding/run`. A second apply while a run is active answers `409`.
5. **Model-aware detection.** `detectDimensionMismatch` also flags a shard whose stored `embedding_model` differs from `CONFIG.embeddingModel`. Shards whose stored model is `legacy-unknown` or empty are flagged only on a size mismatch, so old stores are not forced into a re-embed on upgrade.
6. **Captures during a run** reload config per unit already (`refreshConfigIfChanged`), so they embed with the new model once the config is written. The shard write lock keeps a capture and the rebuild of the same shard apart. The embedding service caches its pipeline, so it is reset whenever the config signature changes.
7. **Token store.** `src/services/api-tokens.ts` keeps `~/.omms/api-tokens.json` (mode 0600), written with its own atomic replace (a 0600 file in a 0700 folder). It does not import `web-ensure.ts`, so a host that stubs that module still loads the token store. A token is `omms_` plus 32 random bytes in base64url. The store keeps a SHA-256 hash; the value has 256 bits of entropy, so a slow hash adds nothing. Lookup compares hashes with `timingSafeEqual`. Last-used time is written at most once a minute per token to limit writes.
8. **Replacing config-token callers.** `web-command.ts` and the start probe talk only to a web app on this machine, so they switch to the local token file. The Web binding health check and the start guard ask the token store for an unexpired token.
9. **One-time import** runs at web app start: if `webServerApiToken` resolves to a value and no `from config file` row exists, store its hash with no expiry. The config file is not edited. The Keys card warns when the config still holds the key.
10. **Password.** Saved through the same private-file path as `memoryApiKey` (`storeMemoryKeySource` in `memory-key-source.ts`, called with the fixed key name `web-password`), written as `webServerAuthPassword: file://...`. Clearing removes the config key; the file is deleted.
11. **Credentials rules** live in one pure function `credentialStates(snapshot)` in the web lib, so the ✅/⛔️/not-needed rules have unit tests without rendering.
12. **Claude Code health rows** read the settings snapshot (`effective["claude-code"]`, `claudeFolder`). The folder row warns rather than fails. The Pi manual test and the Claude Code test share one lazy external API probe per run.
13. **External API diagnostics** are filled at the start of the external `summarize`, like the Pi provider, so failures carry the model too.
14. **Host filter** is a `host` query value on `/api/settings/diagnostics`, checked against the three ids and passed to `queryCaptureAttempts` as a `WHERE host = ?` clause. Host labels come from `hostLabel`.
15. **Import refresh** subscribes the Import section to `onSettingsSnapshot` and re-reads `/api/settings/imports/readiness`.

16. **One skill file, three loaders.** `skills/omms-memory/SKILL.md` stays in the repository root, where the Claude Code plugin already reads `skills/`. `package.json` adds `skills` to `files` and `"skills": ["./skills"]` to the `pi` block, which Pi reads from installed packages. The OpenCode V1 `config` hook (already present in `src/index.ts`) appends the package's absolute `skills` folder to `cfg.skills.paths`, resolved from the module URL; OpenCode rescans `config.get()` after the hook. OpenCode V2 has no skills-folder setting, so the V2 adapter adds the skill through `ctx.skill.transform`: it reads `SKILL.md` and adds one skill record (`id`, `name`, `description`, `path`, `content`) once. Both loaders live in `src/adapters/opencode/package-skills.ts`, which finds the package root by walking up to the `package.json` named `om-memory-system`. The path is resolved once and skipped with a log line when the folder is missing.

- Alternative: copy the skill into `~/.config/opencode/skills/` at start. Rejected: it writes into another tool's config folder and leaves stale copies after uninstall.

17. **Host-neutral instructions.** The skill says: use the `memory` tool when it is in the tool list; otherwise run `om-memory-system memory`. One file then serves all hosts. The name stays `omms-memory`, so Claude Code users keep the command they know and no alias is needed.
18. **The header matters more than the skill.** A skill loads only when the agent chooses it. The injected header reaches every session. `formatContextForPrompt` in `src/services/context.ts` is shared by every host through `src/core/retrieval.ts`, so one text change covers all of them. The header gains one sentence and stays under 60 words, to keep the per-turn cost small.
19. **Tool text.** The `memory` tool description in Pi and OpenCode gains "Search before debugging or investigating: earlier fixes and decisions are stored here." Both hosts build the same string today, so the text moves to one shared constant in `src/core/`.

20. **Profile time limit by override, not a new setting.** `selectImportModel` builds a second provider for the profile port with `buildMemoryProviderConfig(CONFIG, { iterationTimeout: 120000 })`. The override already exists. 120 seconds matches the limit the Pi and OpenCode host-model profile paths already use (`src/adapters/pi/profile.ts`, `src/adapters/opencode/profile-learning.ts`).

- Alternative: raise `autoCaptureIterationTimeout`. Rejected: a stuck capture would then block the capture queue for longer.

21. **Reason codes.** The profile port throws an error that carries the provider result's code: `timeout` for `API request timeout`, `http-<status>` when `httpStatus` is set, `no-tool-call` for `Max iterations`, `invalid-reply` for validation errors, else `error`. One pure function in `src/core/` maps a thrown error to the code, used by the Claude Code and Pi log lines and by OpenCode's.
22. **Wait after failure.** One small in-process gate in `src/core/` (`profileBackoff`) records the time of the last failure; each host checks it before a pass. The wait lives in memory only, so a restart tries again at once, which is acceptable.
23. **Recent first.** `getPromptsForUserLearning` gains a `recentFirst` option: `WHERE user_learning_captured = 0 AND created_at >= now - 7 days ORDER BY created_at DESC`, falling back to the oldest-first query when that is empty. Live passes on every host use it; imports and catch-up keep oldest first. The existing index on `created_at` serves both. Pi keeps the current session's prompts in memory and analyses them as its batch, so its live pass is recent by design and does not query the store; imported prompts wait for a catch-up run.
24. **Trivial prompts.** One pure predicate in `src/core/`, `isTrivialPrompt`: trimmed text under 20 characters and fewer than three words. The word rule keeps short real preferences such as `use bun not npm` (15 characters). Before each pass, trivial waiting prompts are marked learned, and the count used for the interval excludes them.
25. **Catch-up reuses the import loop.** The batch loop in `src/importer/profile-import.ts` moves into a shared `drainProfileBacklog(model, { batchSize, signal, onProgress })`. The catch-up job wraps it with a job record (like the history import job: state, counts, pause by abort signal and resume by a new run), a run record shared across processes, and the 10-minute failure wait bypassed because the user asked for it. The route is loopback plus local token, like the import routes.
26. **Catch-up run record across processes.** The web app and the terminal command are separate processes, so an in-memory lock cannot keep them apart. One row in a `profile_catch_up_lease` table in `user-prompts.db` holds the owner ID, the ID of the owner that is sending a batch (`busy_owner`), and a refresh time. A new run writes itself as owner, so the newest run wins. Before each batch a run makes one conditional update: it succeeds only when the run is still owner and no other owner is mid-batch (or that owner's record is older than 10 minutes). If the run is no longer owner it stops with `superseded`; if another owner is mid-batch it waits and tries again every second. After each batch it clears `busy_owner`; at the end it deletes the row if it still owns it. 10 minutes covers one batch with its retry at the 120-second limit. The Claude Code live pass in the web app skips while an unexpired record exists. Inside one web app a second start still answers `409`, because the page offers only Pause while a run is active.
    - Alternative: claim each batch of prompts before sending it. Rejected: two runs would then merge into the profile in parallel, and profile updates already refuse a conflicting write.

27. **Model choice.** The page uses the saved external API. To try another model, the user changes it in the External API card, or uses the terminal flags, which reuse `selectImportModel` flags so nothing is saved.

28. **Evidence that Claude Code is in use.** The Keys card needs `memoryApiKey` for Claude Code only when a `capture_attempts` row with host `claude-code` exists, or `claudeConfigDir` is set in the global config. The existence of the default folder is not evidence, because Claude Code may be installed without the OMMS plugin. The grey label for this row reads **never used before**, which is accurate for both cases.

## Risks / Trade-offs

- [A catch-up run costs about 52 paid calls] → The count is shown before it starts; it can be paused; a dry run shows the numbers.
- [The model is slow or weak] → The terminal command takes another model without saving it, and the External API card changes the default.
- [Agents still skip the search sometimes] → The skill, the header, and the tool text raise the chance but cannot force a model. The user can invoke the skill by name.

- [A re-embed of 3,530 memories on a paid API costs money] → The confirmation states the count and the per-memory call; local presets are listed first.
- [Search is poor during a run] → The Memories page and the card show that a re-embed is running.
- [Ignoring `webServerApiToken` after import breaks config-as-code setups] → One-time import keeps current callers working; the change is released as breaking and the docs say how to move.
- [Token file lost or deleted] → Tokens stop working; the local token file still lets the page open, and the user generates new tokens.
- [Stubbed `settings-snapshot.js` in tests returns `{}`] → Claude Code health rows and credential states handle missing fields and report fail or unknown instead of throwing.
- [This change touches many files] → Tasks keep each part test-first and separately verifiable; the PR stays under 100 files.

## Migration Plan

1. Release as a major version because of the config key.
2. On first start, the token import runs. No user action for current callers.
3. Rollback: the previous version reads `webServerApiToken` again, which the import left in place.
