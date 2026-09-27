# Tasks

## 1. Config and kill switches

- [ ] 1.1 Add `autoBackfill` (default `true`), `opencodeBackfillModel` and `piBackfillModel` (default `inherit`), and `webServerAutoStart` (default `true`) to `src/config.ts` and the config template, global-only, with validation (`inherit` or `provider/model` with non-empty parts); verify with config tests for defaults, a project value being ignored, and an invalid model value rejected at load
- [ ] 1.2 Add `src/importer/backfill-model.ts` (pure; takes `CONFIG`) that parses a backfill model value into `inherit` or `{ provider, model }`; verify with unit tests for `inherit`, `zai/glm-5-turbo`, `a/b/c` (model keeps its slashes), and empty parts
- [ ] 1.3 Add `OMMS_DISABLE_AUTO_BACKFILL=1` and `OMMS_DISABLE_WEB_AUTOSTART=1` to `.env.test`; verify with a test that a spawned child sees both variables

## 2. Live-capture skip (all import surfaces)

- [ ] 2.1 Add a read-only store helper that returns the `sourceEntryIds` of non-import memories for a host, host session, and project; verify with a store test seeded with live-capture and history-import memories for two sessions
- [ ] 2.2 Use it in the Pi importer (`importer.ts`): skip units whose user entry ID is in the set, with ledger reason `live-captured`, and report them as skipped (dry runs do not write the ledger); verify with an importer test where one of three units was live-captured
- [ ] 2.3 Use it in the OpenCode importer (`opencode-import.ts`) on the user message ID; verify with the same test shape on an OpenCode fixture database
- [ ] 2.4 Verify both hosts' existing importer, CLI, and web-import tests still pass with `bun test` on each file

## 3. Backfill state and lock

- [ ] 3.1 Add the `backfill_state` table to `import-ledger.db` with read, create-cutoff-once, and update functions; verify with tests that the first call records a cutoff, a second call returns the same cutoff, and status updates never store text longer than an error message
- [ ] 3.2 Add the per-host cross-process lock `backfill-<host>.lock` with PID liveness and stale reclaim; verify with a two-process test (one holder, one refused) and a test that a lock left by a dead PID is reclaimed

## 4. Backfill runner

- [ ] 4.1 Implement `scheduleAutoBackfill` in `src/importer/auto-backfill.ts` per design D1: start delay, switch and kill-switch check, lock, cutoff, dry run over all projects with `until: cutoff`, early `done` when nothing is pending, model resolution callback, real run with an `AbortSignal`, final status; verify with runner tests using an injected import runner and clock
- [ ] 4.2 Add pacing and stopping per D2: config refresh and status writes at most every 5 seconds, abort when `autoBackfill` becomes false, and abort after 5 consecutive capture failures with the error recorded; verify with tests for each stop path and that failed units are retried on the next run
- [ ] 4.3 Prevent an automatic run while a manual session import runs in the same process, sharing the running flag with both import commands; verify with a test
- [ ] 4.4 Start and finish notices through a `notify` callback, with count, model, and the `autoBackfill` setting name, and no conversation text; verify with a test that captures the notices

## 5. Host wiring

- [ ] 5.1 Pi: call `scheduleAutoBackfill` once per process from the first `session_start`, resolving models per D5 (`resolveImportModel` for `provider/model`, `createPiLiveModels` for `inherit`); verify with a Pi extension test that a configured `piBackfillModel` is resolved and that `inherit` follows the live-model rule
- [ ] 5.2 OpenCode (V1 plugin, and the V2 adapter through it): call it from plugin init after the provider list loads, resolving per D5 including `client.config.get()` for session mode; verify with plugin tests for a connected `provider/model`, an unconnected provider (status `failed`, no model call), and session mode
- [ ] 5.3 Both hosts: call `reconcileWebAutostart()` in the background at start; verify with tests that it is invoked and that a thrown error is logged, not raised
- [ ] 5.4 Check the boundary tests still pass: `bun test tests/host-neutral-capture-boundary.test.ts tests/pi-adapter-boundary.test.ts tests/plugin-bundle-boundary.test.ts` (one file per run)

## 6. Login item and `web` command

- [ ] 6.1 Implement `src/services/web-autostart.ts` per D8 (runtime and package-path resolution, macOS plist, Linux systemd user unit, Windows Startup `.cmd`, rewrite on path change, own-item-only removal, status); verify with tests against a temp home for each platform's file content, rewrite on a changed path, removal leaving a foreign file untouched, `no-runtime`, and `unsupported`
- [ ] 6.2 Add `web`, `web install`, `web uninstall`, and `web status` to `src/cli/index.ts` per D9, with `install`/`uninstall` saving `webServerAutoStart` through the config writer; verify with CLI tests in a temp home (platform commands such as `launchctl` injected) and a test that `web` refuses when `webServerEnabled` is false
- [ ] 6.3 Standalone mode: run `startWebServer` from the CLI with no host, following port ownership and takeover; verify with a test that starts the CLI server on a free port, loads `/api/settings`, and stops on `SIGTERM`

## 7. Settings API and page

- [ ] 7.1 Add the four keys to `global-config-writer.ts` and `settings-snapshot.ts`; verify with writer tests for each key and a snapshot test
- [ ] 7.2 Add `GET /api/settings/backfill` (both hosts' status, no side effects) and include the login item status in the settings snapshot or its own `GET`; verify with web-server tests that no secret or conversation text appears
- [ ] 7.3 Add `AutoImportSection.tsx` and `WebAppSection.tsx` per D11, with polling while running and strings in every language file; verify with component or page tests for saving each setting, the running poll, and the unsupported-platform message, and with `bun run build`

## 8. Docs and release notes

- [ ] 8.1 Update `docs/configuration.md` (four settings), `docs/cli.md` (`web` commands), `docs/web-ui.md` (login item, standalone mode, new sections), `docs/pi-history-import.md` and `docs/opencode-history-import.md` (automatic backfill, cutoff, live-capture skip), and `README.md` if its setup text changes; verify by reading each against the specs
- [ ] 8.2 Add an ADR in `docs/adr/` for default-on automatic backfill and login item, and add it to the ADR index; verify the index links it
- [ ] 8.3 Keep `CONTRIBUTING.md` in step if commands changed; verify with a diff review

## 9. Verification

- [ ] 9.1 Run `bun run ci:local` and confirm it passes, and that `~/.omms` and the user's login items are unchanged by the run
- [ ] 9.2 Run `bun run check:package` after `bun run build`, since the CLI changes
- [ ] 9.3 Manual check on this machine: start Pi with a scratch store (`storagePath` in a temp dir) and a small copy of a sessions folder, and watch the backfill import, resume after a restart, and skip live-captured exchanges; run `om-memory-system web status` and `web install`/`uninstall` against a temp home
- [ ] 9.4 Run the `openspec-verify-change` skill and fix every finding
