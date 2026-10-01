## Why

The Settings page has gaps that make users edit `omms.jsonc` by hand or guess what is wrong:

- The embedder (the model that turns text into search vectors) cannot be seen or changed on the page. Changing it by hand silently breaks search until every memory is re-embedded. A change to another model with the same vector size is not detected at all.
- An embedding server without a key (Ollama, llama.cpp) needs a made-up key, because OMMS uses an embedding URL only when a key is also set.
- The API token is one fixed string in the config file, with no name, expiry, or revoke. The browser password can be set only by hand.
- The credentials line sits under the Claude Code card and reads as a list of problems.
- Claude Code, the newest host, is missing from Health, and its diagnostics rows have no model. Diagnostics cannot be filtered by host.
- The Import section shows a stale external API model after the user saves a new one.
- Agents do not search the memory store before they investigate. The memory context that OMMS adds says only that it is "background information", and never that it holds just the closest matches or that a full search exists. Pi and OpenCode have no OMMS skill at all. In one Pi session the agent re-investigated a fix that OMMS had stored.
- Profile learning on the external API always fails. It borrows the capture time limit of 30 seconds, and a profile call to `glm-5-turbo` took 66 seconds in a timed test. The log says only "History profile model call failed" (Pi) or `{"code":"Error"}` (Claude Code), and the same batch is retried, and paid for, after every turn. 2,902 prompts are waiting.

## What Changes

- **Embedding card (new).** Shows the embedder in use, locked behind a padlock. Unlocked, the user picks **Built-in model** or **OpenAI-compatible server** with presets (Ollama, llama.cpp, OpenRouter, OpenAI, Custom), types the exact model name, and sets an optional API key with the same key picker as External API. **Test** embeds one sentence and fills the dimensions. **Apply** is allowed only after a passing test, asks for confirmation with the risks and the memory count, then saves and re-embeds every memory with progress. A failed run can be retried.
- **Embedding server key becomes optional.** A URL alone selects the server. The key is sent only when set.
- **Model change detection.** The re-embed check compares the stored model name as well as the vector size.
- **Keys and access card (new).** Replaces the credentials line. One row per credential: ✅ set, ⛔️ needed but missing, or grey **not needed** (**never used before** for the external API key), with what it is for and which hosts use it. Includes:
  - **API tokens table:** generate a named token with an expiry (7, 30, 90 days, or never), shown once, stored only as a hash; list name, created, expiry, last used; revoke.
  - **Browser password:** set or clear the Basic Auth password and user name.
- **BREAKING (config):** `webServerApiToken` in `omms.jsonc` stops being read after a one-time import into the token table as "from config file, never expires". Users who set it keep working without action. Scripts must use a token from the table from then on; the imported token is one.
- **Claude Code in Health:** **Claude Code model**, **Claude Code folder**, and (with model tests) **Claude Code model test** rows. One run makes at most one external API test call.
- **Capture diagnostics:** external API attempts record path, provider, and model on every host. Tables show host display names. A **Host** filter (All, OpenCode, Pi, Claude Code) filters on the server.
- **Import section:** the option reads **Saved external API**, without the model name, and the section reloads readiness after any settings save.
- **`omms-memory` skill for every host.** The existing Claude Code skill, `skills/omms-memory/SKILL.md`, becomes host-neutral and is loaded by the Claude Code plugin, the Pi package (`pi.skills`), and the OpenCode plugin (its config hook adds the package's skill folder). Its name stays `omms-memory`. It tells the agent to search the full store before debugging, investigating, or answering about earlier work.
- **Memory context and tool text.** The injected memory header says the memories are the closest matches only and to search the full store first. The `memory` tool description says to search it before debugging.
- **Profile learning fix.** External API profile calls get their own 120-second limit; captures keep theirs. A failure logs a fixed reason code (`timeout`, `http-<status>`, and others). After a failure, a process waits 10 minutes before the next profile pass. Live learning reads prompts from the last 7 days first, so a history backlog cannot starve it. Prompts under 20 characters skip the model. A **Catch up profile** button and `om-memory-system profile-catch-up` clear the backlog in batches of 50 after a confirmation with the call count; the terminal command can use another model.
- **Records and docs:** a new ADR for managed API tokens and the embedding change flow; updated Settings, Web UI, configuration, and Claude Code docs.

## Capabilities

### New Capabilities

- `web-api-tokens`: named, expiring, hashed API tokens that authorise API requests, their one-time import from the config key, and who may manage them.
- `omms-skill`: one `omms-memory` skill loaded by every host, and memory context and tool text that tell the agent to search the full store.
- `profile-learning`: the profile call time limit, failure reason codes, the wait after a failure, recent-first batches, skipping trivial prompts, and the catch-up run.
- `embedding-settings`: choosing the embedder, the optional server key, testing a candidate embedder, and re-embedding on change with model-aware mismatch detection.

### Modified Capabilities

- `web-settings`: the Embedding card, the Keys and access card, Claude Code health rows, the diagnostics host filter and host names, and the import model option and refresh.
- `capture-diagnostics`: external API attempts record path, provider, and model.

## Impact

- Server: `src/services/web-server.ts`, `src/services/web-api-auth.ts`, `src/cli/web-command.ts`, new `src/services/api-tokens.ts`, `src/services/embedding.ts`, `src/services/migration-service.ts`, `src/services/settings-snapshot.ts`, `src/services/global-config-writer.ts`, `src/config.ts`, `src/importer/settings-health.ts`, `src/importer/model-selection.ts`, `src/services/capture-attempt-store.ts`.
- Web: new `EmbeddingSection.tsx`, `KeysAccessSection.tsx`, `ApiTokensTable.tsx`; changes to `ModelsSection.tsx`, `DiagnosticsSection.tsx`, `ImportSection.tsx`, `HealthSection.tsx`, `SettingsView.tsx`, `web/src/lib/i18n/settings.ts`.
- Profile learning: `src/importer/model-selection.ts` (profile provider time limit and reason), `src/importer/claude-hook-api.ts`, `src/adapters/pi/profile.ts`, a shared reason-code and wait helper in `src/core/`, `src/services/user-prompt/user-prompt-manager.ts` (recent-first and trivial-prompt queries), `src/importer/profile-import.ts` (shared batch loop), a new catch-up job and route in the web server, `src/cli/` (`profile-catch-up`), and a new `ProfileCatchUpSection.tsx`.
- Skill and guidance: `skills/omms-memory/SKILL.md` rewritten for every host; `package.json` (`files` adds `skills`, `pi.skills`); the OpenCode V1 config hook in `src/index.ts` and the V2 adapter; `src/services/context.ts`; the `memory` tool text in `src/index.ts` and `src/adapters/pi/extension.ts`; `tests/claude-plugin-assets.test.ts`.
- New data file `~/.omms/api-tokens.json` (mode 0600). No change to memory or shard formats; a re-embed rewrites vectors through the existing migration service.
- Docs: `docs/web-ui-settings.md`, `docs/web-ui.md`, `docs/configuration.md`, `docs/claude-code-adapter.md`, `docs/pi-adapter.md`, `docs/opencode-adapter.md`, `docs/using-memory.md`, new `docs/adr/015-*.md` and `docs/adr/016-*.md` with their index rows.
- Release: `feat!:` or a `BREAKING CHANGE:` footer for the config key, so release-please proposes 4.0.0.
