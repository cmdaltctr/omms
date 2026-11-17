## Why

On 14 November 2026 the global OMMS install was left half written: the `js-base64` folder was empty. The web app could not start, and the login item does not restart a web app that exits. The logs show why it can happen. Every update is logged twice a few seconds apart, and one of the two then fails to restart. Two standalone web apps saw the same new release and both ran `npm install -g om-memory-system` on the same folder. Nothing checks the install after npm exits, and the launcher counts a copy as valid when `package.json` and `dist/cli/index.js` exist, so it chose the broken copy over a working one.

## What Changes

- Only one `npm install -g om-memory-system` runs at a time on a machine. The web app (automatic start and the Update button) and `om-memory-system web update` take a lock file first. A caller that finds the lock held does not run npm.
- A caller re-reads the global version after it takes the lock. When another caller already installed the release, it skips npm and goes straight to the restart.
- After npm exits with 0 and reports the new version, the caller checks that the install is complete: every dependency in its `package.json` resolves, and `dist/cli/index.js` exists. An incomplete install is repaired once by running the same install again. If it is still incomplete, the web app keeps serving its current version and reports the code `incomplete-install`.
- The lock also names npm's process, so a web app that exits mid-install leaves a live lock. Stop, hand-over, step-aside and retire wait for an install in progress before they exit.
- `om-memory-system web update` checks and repairs the global install also when it is already on the latest version. Repair advice names `npx -p om-memory-system@latest om-memory-system web update` instead of a raw `npm i -g`, which skips the lock. The web app's failure line names a next step for the common codes.
- The launcher and the copy check treat a copy with a missing dependency as not valid, so the login item falls back to the next valid copy instead of a broken one.
- The login item restarts the web app after a crash (macOS and Linux), with a limit of 5 failed starts in 10 minutes, after which it stops and logs one code. Stop, hand-over and update restarts exit with 0 and are not restarted.

Not changed: the host self-updates for Pi, OpenCode and Claude Code. They run each host's own update command, which writes the host's cache, not the global install.

## Known small issues

Found in the review and left in the code, because each scores 3 or below (likelihood times impact):

- A failed repair reports `incomplete-install` and hides the real npm code, such as `timeout` (likelihood 1, impact 2, score 2).
- The launcher falls back to an older copy with no log line (likelihood 2, impact 1, score 2).
- A Restart or `web update` inside a 10-minute window that already holds 5 failures hits `restart-limit` and stays down (likelihood 1, impact 3, score 3).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-update`: adds the install lock, the re-check under the lock and the post-install check with one repair.
- `web-autostart`: adds the rule that a copy with a missing dependency is not valid, and the login item watchdog.

## Impact

- Code: `src/services/web-update.ts`, `src/services/web-update-runtime.ts`, `src/cli/web-update-command.ts`, `src/services/runtime-record.ts`, `bin/omms-launch.mjs`, `src/services/web-autostart.ts`, `src/services/web-ensure.ts`, `src/cli/web-power.ts`, `src/cli/web-step-aside.ts`, `src/cli/web-command.ts`, one new module for the install lock and one for the install check. Web UI: the update dialog's failure lines and global command (`UpdateButton.tsx`, `translations.ts`) and the Settings version notice command (`external-api-settings.ts`).
- Docs: `docs/cli.md`, `docs/web-ui.md`, `docs/upgrading.md` and TDR 086.
- Tests for each requirement. No new dependency and no change to stored memory.
- Windows: the startup item has no supervisor, so it gets the lock and the install check but not the watchdog.
