# Tasks

Each fix follows TDD: write the test, run it, and confirm it fails on the current code. Make the fix and confirm the test passes. Break the fix on purpose, confirm the test fails again, then restore the fix. Record each red, green, and re-red run in `notes.md` with the command.

## 0. Setup

- [x] 0.1 Confirm `git rev-parse --show-toplevel` and `git branch --show-current` print this worktree and `feat/web-lifecycle-hardening`. Ask the user, then run `bun install --frozen-lockfile` and `(cd web && bun install --frozen-lockfile)` here. Verify with `bun run check`.

## 1. Atomic stale-lock takeover

- [x] 1.1 Export `takeStartLock` from `src/services/web-ensure.ts` with no change in behaviour, so a test can call it. Verify `bun test tests/web-ensure.test.ts` still passes.
- [x] 1.2 Add an injected-filesystem test to `tests/web-ensure.test.ts`. An in-memory `LockFs` runs caller B in full inside each file step of caller A, for every step index. Both callers see the same stale lock. Assert that exactly one caller returns `true` and that the lock names the winner. Confirm it fails on the current `takeLock`.
- [x] 1.3 Add `link` and `ageMs` to `LockFs` and `nodeLockFs`. Rewrite `takeStartLock` with the tombstone steps in design.md Decision 1. Verify 1.2 passes, then break the text check (step 3) and confirm 1.2 fails again. Restore.
- [x] 1.4 Add tests for a stale tombstone (older than 20 seconds: removed, call returns `false`, next call takes the lock) and a fresh tombstone (call returns `false`, tombstone stays). Confirm both fail before 1.3's tombstone-age code exists, or record why one cannot fail first.
- [x] 1.5 Add a real-process test to `tests/web-ensure-real-process.test.ts`: write a stale lock (dead pid) in a temp HOME, start several `takeStartLock` callers at once through `dist/`, and assert exactly one gets the lock and no tombstone remains. Run `bun run build` first. Verify it passes five runs in a row.

## 2. Atomic lock replace for Restart

- [x] 2.1 Add a test to `tests/web-ensure.test.ts` that `nodeLockFs.replace` on an existing lock leaves the new text and no `.tmp` file, and that a reader never sees a missing file between two replaces (read in a tight loop while replacing). Confirm it fails (no `replace` yet).
- [x] 2.2 Add `replace` (write temp, rename over) to `LockFs` and `nodeLockFs`. Use it in production `writeStartLock` in `src/cli/web-power.ts`. Verify 2.1 passes, break the rename, confirm it fails, restore.

## 3. Restart recovery

- [x] 3.1 In `tests/web-power-action.test.ts`, extend the fake with `resumeServer`, `probe`, `sleep`, `now`, `kill`, and child `error`/`exit` events. Change the order expectations of the two existing restart tests to the new order (lock, spawn, check, lock copy, stop, watch, exit). Record the change in `notes.md`: the order is the behaviour this change fixes, so no assertion is weakened.
- [x] 3.2 Add failing tests, detached path: spawn throws → no stop, no exit, lock released, one log code; child has no pid → same; child emits `error` within 1 second → same; child emits `exit` after the stop → `resumeServer` runs, no exit; no OMMS answer in 15 seconds → copy killed, `resumeServer` runs; OMMS answer → exit `0`.
- [x] 3.3 Add failing tests, login-item path: service manager succeeds → stop, restart, exit `0` (unchanged); service manager fails and the copy cannot spawn → `resumeServer` runs, no exit; service manager fails and the copy answers → exit `0`.
- [x] 3.4 Implement `handOff` in `src/cli/web-power.ts` per design.md Decision 3. Verify 3.1 to 3.3 pass. Break the spawn check, confirm 3.2 fails, restore. Break the watch, confirm the watch tests fail, restore.
- [x] 3.5 Add a test that `WebServer.stop()` followed by `start()` binds the port again. Confirm it fails, then set `startPromise = null` in `stop()`. Verify, break, re-verify, restore. Remove the now-redundant manual reset in the step-aside path only if its test still passes; otherwise leave it.
- [x] 3.6 Wire `resumeServer` in `src/cli/web-command.ts`: re-add the keep-alive timer and signal handlers, then `server.start()`.
- [x] 3.7 In `tests/web-power-restart.test.ts`, add a real-process test: start a standalone web app in a temp HOME on a spare port whose restart copy cannot run (for example, the copy's script path points to a missing file through a test-only environment variable read by `productionDeps`, or `execPath` set to a missing file). POST `/api/web/restart`. Assert `202`, the same pid still listens after 5 seconds, and the log has `Web app restart failed`. Confirm it fails on the pre-3.4 code (the process exits and the port is free). Clean up the process and the temp HOME in `finally`.
- [x] 3.8 Run the existing restart test in `tests/web-power-restart.test.ts` and confirm the new process still takes the port, now within the longer handoff time.

## 4. Status instance and page

- [x] 4.1 Add a test to `tests/web-power-control.test.ts` that `/api/web/status` returns a string `instance`, the same value on two calls. Confirm it fails, add the field, verify, break, restore.
- [x] 4.2 In `web/tests/power-api.spec.ts`, add failing tests for `waitForWebApp(previous)`: new instance → `"restarted"`; old instance until the end → `"unchanged"`; no answer → `"down"`. Implement in `web/src/lib/power.ts` (30-second wait, 500 ms poll). Verify, break, restore.
- [x] 4.3 In `web/tests/power-button.spec.tsx`, add a failing test: after Restart with `"unchanged"`, the page shows the restart-failed message and stays usable. Update `PowerButton.tsx` and add the message to every locale file that has the other `power-` strings. Verify, break, restore.

## 5. Docstrings

- [x] 5.1 List the exported items that PR #51 added or changed and that have no docstring, with `git diff 2a8dd86 91f7457` on the five files in the proposal. Write the list to `notes.md`.
- [x] 5.2 Add one short docstring (why, not what) to each item on the list. Touch no other code. Verify with `bun run check`.

## 6. Docs

- [x] 6.1 Update `docs/web-ui.md`: Restart starts the copy first, keeps serving on failure, can take up to about 7 seconds, and the page reports a failed restart. Use STE style.
- [x] 6.2 Add a TDR in `docs/tdr/` for the tombstone lock takeover, and add it to the folder index.
- [x] 6.3 Only if the user approved it: set ADR-014 **Status:** to Accepted in `docs/adr/014-one-shared-web-app-for-every-host.md` and in `docs/adr/ADR_README.md`.

## 7. Verify

- [x] 7.1 Run `bun run build`, then each new or changed test file on its own. All pass.
- [x] 7.2 Run `bun run ci:local` in the background. It passes.
- [x] 7.3 Browser check in a temp HOME on a spare port: Restart succeeds and the page reloads; Restart with a broken copy shows the failure message and the page keeps working. Record in `notes.md`. Do not touch the real login item (pid 21883).
- [x] 7.4 Run the `openspec-verify-change` skill and fix every finding.
- [x] 7.5 Run `openspec archive web-lifecycle-hardening` through the `openspec-archive-change` skill before the pull request.
