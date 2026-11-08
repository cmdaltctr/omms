## 1. Shared self-update module

- [x] 1.1 Write failing tests in `tests/host-self-update.test.ts`: disabled, current, prerelease, unreachable npm, recent marker, started, spawn-failed, local path skip, pinned skip. Confirm they fail before the module exists.
- [x] 1.2 Add `src/services/host-self-update.ts` with a deps object (no `CONFIG` import): decision, marker write before spawn, detached Node script that runs the host command and writes `outcome` and `finishedAt` to the marker.
- [x] 1.3 Add a marker reader that returns `pending`, `installed` or `failed` for a version. Test each state and an unreadable file.
- [x] 1.4 Add install-source checks: module path under `node_modules/om-memory-system/`; OpenCode cache folder `@latest` or no version; Pi `packages` entry without `@<version>`; unreadable Pi settings count as pinned. Test each case.

## 2. OpenCode V2

- [x] 2.1 Write failing tests in the `tui-status` test file for: update started (installing toast), installed (footer `· <v> installed, restart` and restart toast), failed (command toast), pinned or local path (today's text).
- [x] 2.2 Wire `src/adapters/opencode/tui-status.ts` to the shared module: start the update after the npm check, poll the marker every 60 seconds for at most 10 minutes, change footer and toast text.
- [x] 2.3 Log one `OpenCode plugin self-update` record with code and versions on start or failed start. No prompt or reply text.

## 3. Pi

- [x] 3.1 Write failing tests for the Pi adapter: start on `session_start`, no delay to `session_start`, 30-minute de-dup, restart notification, failed notification, suffix kept for `↻` and `✎`, no label without a user interface, poll stops on `session_shutdown`.
- [x] 3.2 Wire `src/adapters/pi/extension.ts` to the shared module. Keep the adapter thin. Add the suffix to the status label.
- [x] 3.3 Log one `Pi plugin self-update` record with code and versions on start or failed start.

## 4. Docs

- [x] 4.1 Update `docs/upgrading.md`: Pi and OpenCode install updates by themselves, then ask for a restart; pinned and local installs do not; `OMMS_DISABLE_UPDATE_CHECK=1` turns it off.
- [x] 4.2 Update `UPDATES.md` to match.
- [x] 4.3 Check `README.md` and `docs/` for text that says Pi or OpenCode never update by themselves, and fix each hit.

## 5. Verify

- [x] 5.1 Run each new and changed test file with `bash scripts/run-tests-isolated.sh <file>`. Break the code once and confirm the tests fail.
- [x] 5.2 Run `bun run check` and confirm the file-size ceiling test passes for `tui-status.ts` and `extension.ts`.
- [x] 5.3 Live check in a scratch HOME with its own store: install an older OMMS in Pi and in OpenCode, start a session, confirm the update command runs once, the marker says `installed`, and the footer shows `installed, restart`. Restart and confirm the new version loads.
- [x] 5.4 Run `bun run ci:local` and read the exit line.
