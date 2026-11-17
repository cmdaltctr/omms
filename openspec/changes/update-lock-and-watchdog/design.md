## Context

The global install is changed by two paths: a standalone web app (`WebUpdate.install` in `src/services/web-update.ts`) and `om-memory-system web update` (`src/cli/web-update-command.ts`). Both call `runGlobalInstall`. Host self-updates (Pi, OpenCode, Claude Code) run each host's own command and write the host's cache, so they are outside this change.

Nothing orders two installs. The 5-minute timeout only stops one npm. After npm exits with 0 the code compares the version in `package.json` and restarts. The launcher (`bin/omms-launch.mjs`) and `copyVersion` (`src/services/runtime-record.ts`) call a copy valid when `package.json` and `dist/cli/index.js` exist, so a copy with an empty dependency folder wins as the newest. The login item has `KeepAlive` false, so it never recovers on its own. See proposal.md for the incident.

## Goals / Non-Goals

**Goals:**

- At most one `npm install -g om-memory-system` at a time on a machine.
- A half-written install is found, repaired once, and never started when it stays broken.
- The login item survives a crash, with a hard limit so it cannot loop forever.

**Non-Goals:**

- No change to how Pi, OpenCode or Claude Code update themselves.
- No queue. A caller that finds the lock held gives up and does not wait.
- No restart rule for the Windows startup item, which has no supervisor.
- No check of dependency versions or file contents, only that each dependency folder holds a `package.json`.

## Decisions

**Lock file, reusing the existing lock code.** `web-ensure.ts` already has `LockFs`, `nodeLockFs`, `processAlive` and `takeStartLock` for the start lock. The install lock uses the same functions with the path `~/.omms/global-install.lock`. `takeStartLock` hard-codes the 20-second start-lock age, so it gets an optional stale-time argument. The install lock is stale when the holder is not running or the file is older than 6 minutes, which is longer than the 5-minute npm timeout. The holder writes a fresh time into the lock before the repair run, so a repair never runs under a lock that another caller can call stale. Alternatives: a database row like `backfill-lock.ts` (it needs the store open, too heavy for a CLI path) and npm's own lock (npm has none for a global prefix).

**The lock names npm too.** The lock file holds `{pid, at, npmPid}`. `runGlobalInstall` passes npm's process ID to `guardedInstall`, which writes it into the lock. The lock is live while the caller or npm runs, and younger than 6 minutes. Without it, a web app that exits mid-install left a lock that looked dead while its npm still wrote, and the next caller ran npm over the same folder. When npm finishes after its caller has gone, the next caller re-reads the version under the lock, finds the copy complete, and skips npm.

**An exit waits for the install.** Stop, a hand-over, a step-aside and a retire exit only after an install this process runs has ended, at most 6 minutes later (`exitAfterInstall` in `global-install.ts`, applied in `createPowerAction` and `leaveAfterStepAside`). The server stops serving at once; only the exit waits. Alternative: detach npm so it outlives the web app. Rejected, because launchd and systemd stop every process of the login item when its main process exits, so a detached npm would still die mid-write there. The wait is also the smaller change: one wrapper, two call sites. A crash or `SIGKILL` cannot wait; the npm process ID in the lock covers that case.

**A busy caller gives up.** An automatic caller logs `install-busy` and tries at its next check in 10 minutes. The button and the terminal report the same code. Waiting would hide the cause and could stack waits. The terminal exit code is 1, so scripts see it.

**`web update` checks a current copy too.** When the global install already reports `latest`, `web update` still calls the guarded install. It skips npm for a complete copy and repairs a broken one. A global install newer than `latest` is left alone.

**Repair advice.** Every message and doc that told the user to run `npm i -g om-memory-system` now names `npx -p om-memory-system@latest om-memory-system web update` (a broken or unknown global copy) or `om-memory-system web update` (a working global command). A raw `npm i -g` skips the lock. A plain `npx om-memory-system@latest` does not help: npm's `exec` runs the global copy when the global tree has that version, and it checks only the top package, not its dependencies (`libnpmexec`, `missingFromTree` with `shallow: true`). `-p` skips that check and installs a fresh copy into npm's cache. `om-memory-system web update` runs the global copy itself. Its start path and the `web update` path load no third-party package (checked by blocking each of the 8 direct dependencies and `js-base64` in turn), so it repairs an empty dependency folder such as `js-base64`. It fails when the copy's own `dist/` is damaged or no global command exists, which the `-p` form covers.

**Read the version again under the lock.** The second caller then finds the release already installed and complete, and only restarts. An install at the release that fails the check is installed again. Without this, it would run npm again on a finished install. The existing CLI already skips npm when the global install is current; the web app path gets the same rule.

**One shared install check.** A new module `src/services/install-check.ts` exports a function that returns the first problem of a copy folder or null: `dist/cli/index.js` missing, a name from `dependencies` with no `package.json` in `<folder>/node_modules/<name>` or in a parent `node_modules` (the order Node.js uses), or a package folder in the copy's own `node_modules` (one level, two for `@scope/name`) with no `package.json`. `optionalDependencies` are skipped, because they differ by platform. The folder scan is needed because `js-base64`, the empty folder of 14 November, is not a direct dependency: `@libsql/hrana-client` needs it. A global install nests every dependency in its own `node_modules`, so the scan covers the whole tree there at the cost of one `readdir` and one `stat` per folder. Host caches hoist dependencies to a shared parent folder, which the scan leaves alone, because other packages live there. `copyVersion`, the web app and the terminal command call it. The launcher cannot import `src/`, so `bin/omms-launch.mjs` holds the same logic, and a test runs both against the same fixture folders so they cannot drift.

**Repair is one more install.** On 14 November, `npm install -g om-memory-system@6.4.0` over the broken folder refilled `js-base64`. The repair therefore repeats the install once under the same lock. A second failure stops there with `incomplete-install`; the code does not loop.

**Watchdog values.** macOS: `KeepAlive` as `{SuccessfulExit: false}` and `ThrottleInterval` 30. Linux: `Restart=on-failure` and `RestartSec=30`. The launcher, in `--login-item` mode, appends a timestamp to `~/.omms/web-starts.json` each time a start fails (the web app exits with a code other than 0, or no copy is valid). Before a start, when 5 failures fall within 10 minutes, it logs `restart-limit` and exits with 0, which neither supervisor restarts. It counts failures, not starts, because Restart and an update restart the item through `launchctl kickstart -k` or `systemctl restart`, and those deliberate starts must not use up the limit. `web install` deletes the file. Under the login item stderr goes to `/dev/null`, so when no copy is valid the launcher also writes `no-valid-copy` with the first missing part to the OMMS log before it counts the failure. The launcher counts only starts it runs. For a launcher that cannot run at all (a removed Node.js), the Linux unit also sets `StartLimitIntervalSec=600` and `StartLimitBurst=6` under `[Unit]`. systemd counts every start, so Restart, an update restart and `web install` run `systemctl --user reset-failed` first; a start the user asks for never uses up the limit. systemd can stop the unit before the launcher logs `restart-limit`. launchd has no start limit beyond `ThrottleInterval`, and no plist key adds one, so on macOS a launcher that cannot run is retried every 30 seconds until the next login; the docs say so. A plain `KeepAlive` true would restart a user's Stop. `SuccessfulExit` false does not, provided every deliberate exit uses code 0.

**Exit codes of deliberate exits.** Stop, hand-over, retire and the restart after an update must exit with 0. A task audits each path and adds a test. A path that exits with another code would now restart and break the rule.

**Older login items.** `installWebAutostart` writes the item content only when it differs, so an older item is rewritten once. The reconcile step runs it at each OpenCode and Pi start, and `web install` runs it; the web app and the Claude Code hooks do not. Reconcile starts nothing: on Linux it runs `systemctl --user daemon-reload`, which applies the restart rule to the running service; on macOS it only writes the file, and launchd reads it at the next login. `web install` reloads the item at once. A task confirms this with a test that starts from the old item text.

## Risks / Trade-offs

- [A deliberate exit with a non-zero code would be restarted] → The exit-code audit and a test per path. The restart limit also bounds the harm.
- [`launchctl kickstart -k` ends the process with a signal, which counts as a failure for the supervisor] → The update restart goes through the launcher path that already exits with 0 after hand-over; a live check on macOS confirms one instance runs, not two.
- [A stale lock blocks updates for up to 6 minutes] → The holder check clears a dead holder at once, so only a live but hung holder waits for the age limit, and the 5-minute npm timeout ends it first.
- [Dependency check misses a corrupt file inside a present folder] → Accepted. The incident was an empty folder, and the check costs a few `stat` calls at each launch.
- [The launcher and the TypeScript check are two copies] → The parity test over shared fixtures.
- [An exit that waits for npm keeps the old process up to 6 minutes after it stopped serving] → It serves nothing and holds no port; the npm timeout ends it within 5 minutes.
- [The systemd start limit can stop the unit before the launcher logs `restart-limit`] → `systemctl --user status omms-web` shows `start-limit-hit`, and the docs name it.
