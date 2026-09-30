# Change notes

## 1. Stale-lock takeover

- 1.2 red: `bun test tests/web-ensure.test.ts` failed on the old `takeLock` with `at: 3, holders: 2`. Caller B ran in full before caller A's `remove`, and both held the lock.
- 1.3 green: 16 pass. Re-red: with the tombstone text check disabled, the test failed with `at: 2` (B finished before A's link, A linked B's live lock and replaced it). Restored: 16 pass.
- 1.3: `replace` was added to `LockFs` in the same edit, because the fake file systems implement the whole interface. Task 2 tests it.
- 1.4: without the tombstone-age code, "clears a tombstone left by a crashed takeover" failed. "waits while another caller holds the tombstone" passes with and without that code. It guards against clearing a live tombstone, so it cannot fail first. Restored: 18 pass.
- 1.5: `bun test tests/web-ensure-real-process.test.ts` passed five runs in a row (6 processes, 1 winner, no tombstone left). It is a smoke test on the real file system. The race window is microseconds, so the deterministic proof is 1.2.

## 2. Atomic lock replace

- 2.1 test: a second process reads the lock in a tight loop for 1.5 seconds while this one replaces it. With `replace` (temp file, rename): 0 misses, 19 pass. With the old remove-then-create body put back into `replace`: 69 500 misses, 1 fail. Restored: 19 pass.
- 2.2: production `writeStartLock` now calls `nodeLockFs.replace`. `tests/web-power-action.test.ts` still passes (6 pass).

## 3. Restart recovery

- 3.1: two existing assertions in `tests/web-power-action.test.ts` changed, because they recorded the behaviour this change fixes:
  - "spawns a detached copy ..." expected `lock, stop, spawn, lock copy, exit`. It is now "starts the copy before it stops serving ..." and expects `lock, spawn, lock copy, stop, exit`.
  - "still exits when the copy cannot be started" expected `lock, stop, exit:0`, which is the bug in the review. It is now "keeps serving when the copy cannot be spawned" and expects `lock, unlock`, with no stop and no exit.
  - The Stop tests, the login-item test, and the login-item fallback test keep their exact event lists.
- 3.2 and 3.3 red: 9 of 13 tests failed on the old `createPowerAction`. Green after 3.4: 13 pass.
- 3.4 re-red: without the spawn check, 3 tests failed. Without the handoff watch (exit at once after the stop), 2 tests failed. Restored: 13 pass.
- `resumeServer` and `baseUrl` are options of `createPowerAction`, next to `stopServer`, because the web command owns the server. `PowerDeps` gained `removeStartLock`, `probe`, `sleep`, and `now`. The copy is stopped through `child.kill`.
- 3.5 red: `tests/web-power-control.test.ts` "serves the port again after stop" failed with `again: false`. Green after `stop()` sets `startPromise = null`: 8 pass. Removing the line again is the red state above. The step-aside path keeps its own reset; it was left alone. `tests/web-step-aside.test.ts`, `web-server-standalone-stop`, and `web-server-health` still pass.
- 3.7: the copy fails without any test-only switch. The test runs the web app from a copy of the build and removes that copy's `dist/cli/index.js` after start. Red on the old `web-power.ts` and `web-command.ts` (from `HEAD`, rebuilt): the old process exited with code 0. Green on the new code: 3 pass.
- 3.8: the existing restart test passes with the new order.

## 4. Status instance and page

- 4.1 red: "reports one instance value per process" failed (no field). Green: 9 pass. Re-red with a fixed instance string: 1 fail. Restored: 9 pass. The two exact `toEqual` status assertions now also expect `instance: expect.any(String)`.
- 4.2: `waitForWebApp` changed its signature (`previousInstance`) and result (`"restarted" | "unchanged" | "down"`), so the two old tests of the boolean API were replaced by tests of the same cases plus the new ones. Red: 5 fail. Green: 8 pass. Re-red with the instance comparison removed: 3 fail. Restored: 8 pass. It polls `/api/web/status` (with the token) instead of `/api/health`, because only the status reports the instance.
- 4.3: the `PowerButton` mock's `waitResult` moved from `true`/`false` to `"restarted"`/`"down"`, to match the new API. Red: 3 fail. Green: 9 pass. Re-red with the `"unchanged"` branch disabled: 1 fail. Restored: 9 pass.
- 4.3 decision: on `"unchanged"` the page reopens the power dialog with the message "The restart failed. The web app still runs." The buttons work again. The message is in all three locales (en, zh, ar) in `web/src/lib/i18n/translations.ts`.

## 5. Docstrings

Exported or route items that PR #51 added or changed (`git diff 2a8dd86 91f7457`) and that had no docstring:

- `src/services/web-ensure.ts`: `EnsureResult`, `EnsureDeps`, `EnsureOptions`, `nodeLockFs`.
- `src/cli/web-power.ts`: `PowerAction`, `PowerDeps`.
- `web/src/lib/power.ts`: `PowerAction`, `PowerStatus`, `STATUS_POLL_MS`.
- `web/src/lib/components/explorer/PowerButton.tsx`: `PowerButton`.
- `src/services/web-server.ts`: `handlePowerAction`, and a one-line comment on the `/api/web/status` route. `setOnPowerAction` already had one.

Items this change added (`LockDeps`, `takeStartLock`, `LockFs` methods, `HANDOFF_WAIT_MS`, `RestartOutcome`, `PROCESS_INSTANCE`) got docstrings when they were written. `bun run check` passes.

## 7. Verify

- 7.1: after `bun run build`, each changed file passed on its own: `web-ensure` 19, `web-ensure-real-process` 2, `web-power-action` 13, `web-power-restart` 3, `web-power-control` 9, `web-step-aside` 6, `web-server-standalone-stop` 1, `opencode-web-ensure` 4, `web-translations-parity` 2, `power-api.spec.ts` 8, `power-button.spec.tsx` 9.
- 7.2: `bun run ci:local` exit code 0, no failing test. Bun prints "Internal error: directory mismatch ... web/tsconfig.app.json" for the web specs; it is a Bun warning and the specs pass.

### 7.3 Browser check (2026-09-30)

Copied build in a temp HOME, port 48995, driven in Chrome. The real login item (pid 21883) was not touched.

- Status: `canControl: true`, `instance` present, button green.
- Restart (good copy): pid 9660 → pid 10111 on the same port. The page reloaded (`navigation.type: reload`) and status showed a new instance.
- Restart (copy broken by removing the copied build's `dist/cli/index.js`): the dialog reopened with "The restart failed. The web app still runs." Pid 10111 still served the port. Log: `Web app restart failed: {"code":"copy-exit"}`.
- Stop from the same dialog: port free. Temp HOME and build removed.
