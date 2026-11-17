## 1. Install check

- [x] 1.1 Add `src/services/install-check.ts` (first problem of a copy folder: missing entry file, a dependency with no `package.json` here or in a parent `node_modules`, or a package folder in the copy's own `node_modules` with no `package.json`; `optionalDependencies` skipped) with `tests/install-check.test.ts` covering a complete copy, an empty dependency folder, an empty folder of a dependency's dependency, a scoped name, a hoisted dependency and an optional one; verify the test fails without the module and passes with it
- [x] 1.2 Make `copyVersion` in `src/services/runtime-record.ts` use the check, and add the same logic to `bin/omms-launch.mjs`; verify a parity test runs both against the same fixture folders and agrees, and that the launcher starts the next valid copy when the newest is incomplete
- [x] 1.3 Print one line naming the missing dependency and exit 1 when no copy is valid; verify in the launcher test

## 2. Install lock

- [x] 2.1 Add the install lock using `takeStartLock` (with a stale-time argument) and `nodeLockFs` at `~/.omms/global-install.lock` (stale after 6 minutes or a dead holder, time refreshed before the repair, released on every outcome); verify with tests for two callers, a dead holder, an old lock and release after failure and timeout
- [x] 2.2 Take the lock in `WebUpdate.install` and in `productionWebUpdateDeps` install, re-read the global version under it and skip npm when it is already the release; verify the automatic caller logs `install-busy` without a failed state, and the button and `web update` report `install-busy` (exit 1)
- [x] 2.3 Run the install check after npm exits with 0 and the version matches, repair once, then fail with `incomplete-install` and no restart; verify the three scenarios (repaired, still broken, complete with no second npm) and that the log holds only codes and the dependency name
- [x] 2.4 Document the lock, the codes `install-busy` and `incomplete-install`, and the repair in `docs/cli.md`, `docs/web-ui.md` and the troubleshooting page; verify each documented code appears in the code

## 3. Login item watchdog

- [x] 3.1 Audit every deliberate exit of the web app (Stop, hand-over, retire, update restart) and make each exit with 0; verify one test per path
- [x] 3.2 Add the restart rule to `itemContent` (macOS `KeepAlive` as `SuccessfulExit` false with `ThrottleInterval` 30, Linux `Restart=on-failure` and `RestartSec=30`, Windows unchanged); verify with unit tests on the generated text for each platform
- [x] 3.3 Add the failed-start counter to the launcher in `--login-item` mode (`~/.omms/web-starts.json`, a failure is a non-zero exit or no valid copy, 5 failures in 10 minutes gives `restart-limit` and exit 0 before the next start, deleted by `web install`); verify with a test that fakes the clock
- [x] 3.4 Confirm that reconcile rewrites an item written by an earlier version once, without starting a second web app, and fix it if it does not; verify with a test that starts from the old item text on macOS and Linux
- [x] 3.5 Document the watchdog, its limit and the Windows gap in `docs/cli.md` and `docs/web-ui.md`; verify the numbers match the code

## 4. Live check and gate

- [x] 4.1 With the user's approval for each step, check on macOS in a scratch HOME and a scratch launchd label, never the real login item: a crash restarts within 30 seconds, Stop does not restart, the limit stops a broken start, and one instance runs after an update restart; verify and record the results (2026-11-17, scratch HOME, label `io.github.cmdaltctr.omms.web.check41`, a `launchctl` wrapper that rewrote the real label, a fake npm: a `kill -9` restarted in 3.55 s; Stop stayed down for over 75 s; 5 failed starts 30 s apart, then `restart-limit` and no more starts. The update restart found two bugs inside launchd's 30-second throttle: a 5-second `kickstart` timeout started a second, detached web app, and the old web app's 30-second wait for a new owner killed the new copy with a second `kickstart`. Fixed with a 45-second `kickstart` timeout and a 60-second owner wait, see TDR 086. After the fix, three runs (update 0 s after a login-item start, twice 0 s after a crash restart) each exited 0 with one login-item web app for 75 s and no second `kickstart`. The real login item, `~/.omms/runtime.json`, the global 6.5.0 install and the real plist checksum were unchanged.)
- [x] 4.2 Run `bun run ci:local` and `openspec validate update-lock-and-watchdog --strict`; verify both exit 0 (2026-11-17: validate passes. `ci:local` ran 594 test files, 5,215 passed. Its 3 failures were `npm pack --dry-run` in `tests/package-skills.test.ts` and `tests/release-smoke-regressions.test.ts`, refused by an extra fake npm the run used as a safety net; both files pass with the real npm and a scratch npm prefix, 3 and 4 passed. The real global install was unchanged before and after.)

## 5. Review fixes

- [x] 5.1 Name npm's process ID in the install lock and treat the lock as live while the holder or npm runs; verify a holder that exits while a fake npm runs leaves `install-busy` for the next caller, and that the next caller skips npm once npm has finished (`tests/global-install-lock.test.ts`, `tests/web-update-install.test.ts`)
- [x] 5.2 Make Stop, hand-over, step-aside and retire wait for an install in progress before they exit, at most 6 minutes; verify in `tests/web-power-action.test.ts`, `tests/web-step-aside-fallback.test.ts` and the limit in `tests/global-install-lock.test.ts`
- [x] 5.3 Make `web update` check and repair a global install that already reports `latest`; change every repair advice from `npm i -g` to `npx -p om-memory-system@latest om-memory-system web update` or `om-memory-system web update`; verify in `tests/web-update-command.test.ts`, `tests/web-command.test.ts`, `tests/omms-launch.test.ts`, `tests/web-external-settings.test.ts` and `web/tests/web-app-version.spec.tsx`
- [x] 5.4 Log `no-valid-copy` with the missing dependency under the login item before the failure is counted; verify in `tests/omms-launch.test.ts`
- [x] 5.5 Add `StartLimitIntervalSec=600` and `StartLimitBurst=6` to the Linux unit, clear the systemd count before Restart and `web install`, and document the macOS gap; verify in `tests/web-autostart-watchdog.test.ts` and `tests/web-autostart.test.ts`
- [x] 5.6 Test the lock wiring in `productionWebUpdateDeps`; verify the test fails when the wiring reverts to the unlocked runner
- [x] 5.7 Name a next step per failure code in the update dialog in English, Chinese and Arabic; verify in `web/tests/update-button.spec.tsx`
- [x] 5.8 Make the multi-process race test import `src/`, so it needs no build; verify it fails when the lock in `src/` is broken

## Workflow follow-up

- Archive the change (`openspec-archive-change`) before the pull request, in the same pull request.
- Commit and open the pull request only when the user says so.
