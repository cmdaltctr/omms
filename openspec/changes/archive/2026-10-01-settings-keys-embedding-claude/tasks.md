# Tasks

Test first for every task: write the test, confirm it fails on the current code, then make it pass. Run one test file at a time with `bun test tests/<file>.test.ts`.

## 1. External API diagnostics and host filter

- [x] 1.1 `tests/import-model-selection.test.ts`: `summarize` through `selectImportModel` fills `path` `external-api`, `provider`, and `model`, on success and on an HTTP failure. Then fill them in `src/importer/model-selection.ts`. Verify: the file passes; `tests/capture-diagnostics*.test.ts` and `tests/capture-pipeline-diagnostics.test.ts` still pass.
- [x] 1.2 Server test for `/api/settings/diagnostics?host=`: `claude-code` returns only its rows in all three lists; `other` returns `400`; no value returns all hosts. Then add the `host` filter to the route and `queryCaptureAttempts`.

## 2. Claude Code health rows

- [x] 2.1 `tests/settings-health-claude.test.ts` (stub pattern of `tests/settings-health-opencode-skip.test.ts`): ready plus folder gives two pass rows; missing key gives fail naming the setting with no secret; missing folder gives warn with the path; a snapshot without Claude Code data gives fail, not a throw; model tests with Pi manual plus Claude Code make one external call and two rows.
- [x] 2.2 Implement in `src/importer/settings-health.ts`. Verify: the new file, `tests/settings-health.test.ts`, `tests/settings-health-opencode-skip.test.ts`, and `tests/web-server-health.test.ts` pass.

## 3. Embedding

- [x] 3.1 Test: with `embeddingApiUrl` set and no key, the embedder calls the server with no `Authorization` header; with a key it sends one; with no URL it uses the built-in model. Then change `src/services/embedding.ts` and any config check that requires both.
- [x] 3.2 Test: `detectDimensionMismatch` flags a shard with the same size and a different stored model, and does not flag a `legacy-unknown` shard of the right size. Then change `src/services/migration-service.ts`.
- [x] 3.3 Test: the embedding service resets its cached pipeline when the config signature changes. Then implement.
- [x] 3.4 Server tests for `POST /api/settings/embedding/test`: pass returns the size; an unknown model fails with no key in the reason; the shared embedder is not changed.
- [x] 3.5 Server tests for `POST /api/settings/embedding/apply` and `GET /api/settings/embedding/run`: refused without a matching recent test (`409`), from a non-loopback caller (`403`), and while a run is active (`409`); on success writes the four keys in one write, answers `202`, and the run reports progress to completion; a failed run can be retried and redoes only out-of-date shards.

## 4. API tokens and password

- [x] 4.1 `tests/api-tokens.test.ts`: create returns the value once and stores only a hash in a 0600 file; list shows no value or hash; a valid token authorises and updates last-used at most once a minute; expired and revoked tokens are refused; comparison uses hashes.
- [x] 4.2 Implement `src/services/api-tokens.ts`.
- [x] 4.3 Server tests: token routes need loopback and the local token (`403`, `401`); `authorizeApiRequest` accepts table tokens and refuses `webServerApiToken` after import; the one-time import adds `from config file` with no expiry and does not edit the config; a network-bound start without a token or password refuses with the message.
- [x] 4.4 Implement the routes, the auth change, the import, and the start guard. Switch `src/cli/web-command.ts` and the start probe to the local token file. Verify: `tests/web-server-token.test.ts` and the other `tests/web-*` files that use `webServerApiToken` pass, updated only where they assert the old config-token behaviour.
- [x] 4.5 Test and implement the browser password save and clear through the private key file path.

## 5. Settings page

- [x] 5.1 `web/tests/credential-states.spec.ts` for `credentialStates`: ✅ set, ⛔️ missing, and not needed for each rule in the spec.
- [x] 5.2 `KeysAccessSection.tsx` and `ApiTokensTable.tsx`, with a spec: generate shows the value once; revoke asks first; controls hidden when not local. Remove the credentials line from `ModelsSection.tsx`.
- [x] 5.3 `EmbeddingSection.tsx`, with a spec: starts locked; presets fill the URL; Apply disabled until a passing test of the current values; the confirmation states the memory count and the risks; progress and Retry.
- [x] 5.4 `DiagnosticsSection.tsx`: Host choice sent to the server; host display names. Spec for the label helper.
- [x] 5.5 `ImportSection.tsx`: option reads **Saved external API**; reload readiness on `onSettingsSnapshot`. Spec that a snapshot publish triggers a readiness reload.
- [x] 5.6 Add the Embedding and Keys and access cards to `SettingsView.tsx`.
- [x] 5.7 Add every new string to `web/src/lib/i18n/settings.ts` in Chinese and Arabic. Verify: `bun test tests/web-settings-i18n.test.ts`.

## 6. omms-memory skill and search guidance

- [x] 6.1 Test that the memory context header says the memories are the closest matches only and tells the agent to search the full store, and still marks them as background information. Then change `src/services/context.ts`.
- [x] 6.2 Test that the Pi and OpenCode `memory` tool descriptions contain the search-first sentence from one shared constant. Then move the text to `src/core/` and use it in `src/index.ts` and `src/adapters/pi/extension.ts`.
- [x] 6.3 Update `tests/claude-plugin-assets.test.ts` to expect `skills/omms-memory/SKILL.md` with `name: omms-memory`, the trigger words, and both the tool and the command paths. Then rewrite the skill.
- [x] 6.4 Test that `package.json` lists `skills` in `files` and `./skills` in `pi.skills`, and that `bun run check:package` sees `skills/omms-memory/SKILL.md` in the packed files. Then change `package.json` and the package check if needed.
- [x] 6.5 Test that the OpenCode V1 config hook adds the package's `skills` folder to `cfg.skills.paths` once, keeps existing paths, and logs and skips a missing folder; and that the V2 adapter adds it to its `skills` list. Then implement. Verify `tests/plugin-bundle-boundary.test.ts` still passes.
- [x] 6.6 By hand, after `bun run build`: `pi` lists `omms-memory` and `/skill:omms-memory` loads it; OpenCode lists `omms-memory`; Claude Code still lists `omms:omms-memory` after a plugin reload.

## 6b. Profile learning fix

- [x] 6b.1 Test that the external profile port uses a 120-second request limit and the capture port keeps `autoCaptureIterationTimeout`. Then add the override in `src/importer/model-selection.ts`.
- [x] 6b.2 Test the reason-code function: timeout, HTTP status, max iterations, validation failure, not configured, other. Then add it in `src/core/` and make the profile port throw errors that carry the code.
- [x] 6b.3 Test that Claude Code and Pi profile failures log host and reason code and no prompt text. Then change `src/importer/claude-hook-api.ts` and `src/adapters/pi/profile.ts` (and OpenCode's log line to match).
- [x] 6b.4 Test the 10-minute wait: after a failure no pass runs for 10 minutes while captures continue; a success clears it. Then add the gate and check it in each host's profile trigger.
- [x] 6b.5 Test `isTrivialPrompt` (under 20 characters and fewer than three words; `use bun not npm` is kept) and that trivial waiting prompts are marked learned without a model call and do not count toward the interval. Then implement in `src/core/` and `user-prompt-manager.ts`.
- [x] 6b.6 Test that a live pass takes prompts from the last 7 days newest first, and falls back to oldest first when none are recent. Then add `recentFirst` and use it in the Claude Code, Pi, and OpenCode live passes.
- [x] 6b.7 Test `drainProfileBacklog`: batches of 50, oldest first, stops on a failed batch with its reason code, keeps finished batches, honours the abort signal. Then move the loop out of `profile-import.ts` and keep the import tests passing.
- [x] 6b.8 Server tests for the catch-up routes: a preview returns waiting prompts and call count; start needs loopback and the local token; a second start answers `409`; a live pass does not overlap; pause and resume; progress to completion.
- [x] 6b.9 Test and implement `om-memory-system profile-catch-up` with `--dry-run`, `--yes`, and the import model flags; without `--yes` it prints the counts and exits without calls.
- [x] 6b.10 `ProfileCatchUpSection.tsx` with a spec: shows the waiting count, confirmation with the call count, progress, Pause and Resume, the failure reason. Add its strings in Chinese and Arabic.
- [x] 6b.12 Test the catch-up run record in `user-prompts.db`: a newer run takes over; the older run stops before its next batch with `superseded`; the newer run waits while the older run is mid-batch; a record older than 10 minutes expires; the page job shows the takeover. Then implement it and use it in the page job, the terminal command, and the Claude Code live pass.
- [x] 6b.11 By hand after `bun run build`: run one Claude Code profile pass against the real external API from this worktree with a temporary store copy, and confirm it finishes.

## 6c. Keys card evidence for Claude Code

- [x] 6c.1 `credential-states.spec.ts`: `memoryApiKey` is needed for Claude Code only on evidence (a recorded Claude Code capture attempt, or a saved `claudeConfigDir`); a default folder alone gives grey **never used before**. Then add the evidence to `GET /api/settings`, change `credentialStates` and the card, and add the string in Chinese and Arabic.
- [x] 6c.2 Update `docs/web-ui-settings.md` (Keys card rule and label) and `docs/using-memory.md`, `docs/cli.md` (catch-up takeover).

- [x] 6c.3 Page fixes from the 8.2 check, each with a spec in `web/tests/settings-page-fixes.spec.tsx`: switching to Built-in model sets the built-in model; a saved server without a key selects **No key**; Clear password shows its own message; the user name and password inputs have visible labels; the untagged-memories dialog remembers a Close and opens again only when more untagged memories appear. The spec now says a preset fills the URL only.
- [x] 6c.4 Test and fix the catch-up preview: it leaves out waiting trivial prompts, so the call count matches the run.

## 7. Records and docs

- [x] 7.1 Write `docs/adr/015-managed-api-tokens-and-embedding-changes.md` with the s-adr skill: why a hashed token table replaces the config key, why the one-time import, why an embedder change must re-embed and is gated by a test. Add its row to `docs/adr/ADR_README.md`.
- [x] 7.2 Update `docs/web-ui-settings.md`: Embedding card, Keys and access card, Claude Code health rows, diagnostics Host filter and model recording, import option and refresh. Remove the line that says the External API card's **Test** covers Claude Code.
- [x] 7.3 Update `docs/web-ui.md` (API tokens replace `webServerApiToken`; Basic Auth from the page), `docs/configuration.md` (`embeddingApiKey` optional; `webServerApiToken` imported once then ignored; the template comment), and `docs/claude-code-adapter.md` (health rows and diagnostics).
- [x] 7.4 Add an upgrade note to `docs/upgrading.md` for the token change.
- [x] 7.5 Write `docs/adr/016-one-memory-skill-for-every-host.md` with the s-adr skill: why one host-neutral `omms-memory` skill loaded by each host's own mechanism, and why the injected header tells the agent to search. Add its row to `docs/adr/ADR_README.md`.
- [x] 7.6 Update `docs/using-memory.md` (when agents search, and how to invoke `omms-memory` in each host), `docs/pi-adapter.md` and `docs/opencode-adapter.md` (the skill ships with the package), and `docs/claude-code-adapter.md` (the skill now covers every host; drop the copy-by-hand step only if the plugin covers it).
- [x] 7.7 Document the profile learning time limit, reason codes, wait, recent-first order, trivial prompts, and the catch-up button and command in `docs/using-memory.md`, `docs/web-ui-settings.md`, `docs/cli.md`, and `docs/claude-code-adapter.md`, and add a TDR in `docs/tdr/` with the s-tdr skill for the 30-second timeout finding, with its index row.

## 8. Checks (last)

- [x] 8.1 `bun run check` and `bun run ci:local` pass.
- [x] 8.2 `bun run build`, run a web app from this worktree on a free port with a temporary home, and check each card by eye: lock, test, apply with a small store, token generate and revoke, password, Health, Diagnostics filter, Import refresh.
