# TDR-086: Concurrent global installs left empty dependency folders

**Date:** 2026-11-17
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** web-update, npm, launcher, login-item

## Context

On 14 November 2026 the web app could not start. The global install of `om-memory-system` was at the new version, but its `node_modules/js-base64` folder was empty. The login item had `KeepAlive` set to `false`, so it stayed down. The launcher called the copy valid, because it checked only `package.json` and `dist/cli/index.js`.

### Root Cause Analysis

- Two standalone web apps saw the same release and each ran `npm install -g om-memory-system@<version>` on the same folder. Nothing ordered the two runs. The log shows each update twice, a few seconds apart.
- npm exited with `0` and the version matched, so the web app restarted onto a half-written copy.
- `js-base64` is not an OMMS dependency. `@libsql/hrana-client` needs it. A check of the direct dependencies alone does not find it.
- On 17 November the global install was found in the same state again (several folders empty, among them `franc-min`, `hono` and `js-base64`).

## Decision

1. **Install lock.** `src/services/global-install.ts` takes `~/.omms/global-install.lock` with the start lock's code (`takeStartLock`, now with a stale-time argument) before npm runs. A held lock gives `install-busy`. The lock names the caller and, while npm runs, npm's process ID. It is stale after 6 minutes, or when both processes have stopped. A web app that exits mid-install (Stop, hand-over, step-aside, retire) waits for npm first, at most 6 minutes: under a login item launchd and systemd stop every process of the item when the web app exits, so detaching npm would not save it.
2. **Install check.** `src/services/install-check.ts` returns the first missing part: `dist/cli/index.js`, a direct dependency that does not resolve, or a package folder in the copy's own `node_modules` without a `package.json`. npm nests every dependency of a global install in that folder, so the scan covers `js-base64`. It costs about 1 ms. `bin/omms-launch.mjs` holds the same logic; `tests/install-check.test.ts` runs both.
3. **One repair.** A failed check runs the same install once more under the lock, then gives `incomplete-install`. `web update` runs the check also when the global install is already on `latest`, so it repairs a broken copy of the current release.
4. **Watchdog.** The macOS item sets `KeepAlive` to `SuccessfulExit` `false` with `ThrottleInterval` `30`. The Linux unit sets `Restart=on-failure` and `RestartSec=30`, with `StartLimitIntervalSec=600` and `StartLimitBurst=6` for a launcher that cannot run at all; Restart, update restarts and `web install` clear that count first. The launcher stops after 5 failed starts in 10 minutes. Under the login item it logs `no-valid-copy` with the missing dependency, because stderr goes to `/dev/null`. launchd has no start limit, so on macOS a launcher that cannot run is retried every 30 seconds until the next login.

## Consequences

### Positive

- One npm run at a time; a broken copy is never started while a complete one exists.

### Negative

- Two copies of the check (TypeScript and the launcher). The shared test keeps them equal.

### Neutral

- Host caches hoist dependencies to a shared folder. The scan leaves that folder alone, so it checks only direct dependencies there.

## Alternatives Considered

| Option                                | Rejected Because                                                 |
| ------------------------------------- | ---------------------------------------------------------------- |
| Walk every `package.json` in the tree | 50 to 90 file reads per launch, for the same result as the scan. |
| `KeepAlive` `true`                    | It restarts a user's Stop.                                       |
| Wait for the lock                     | It hides the cause and can stack waits.                          |
| Detach npm so it outlives the web app | launchd and systemd stop every process of the login item anyway. |

## How to Recognise / Handle This Again

1. The web app does not start after an update. The log has two `Web app update` records for one release, or `incomplete-install`.
2. Look for an empty folder in `<prefix>/lib/node_modules/om-memory-system/node_modules`.
3. Run `npx -p om-memory-system@latest om-memory-system web update`. It takes the install lock and repairs the global install. `-p` takes a fresh copy: a plain `npx om-memory-system@latest` runs the global copy when it already has that version. A plain `npm i -g` skips the lock.

## Revisit Triggers

- npm adds a lock for global installs.
- OMMS stops shipping through a global npm install.

## References

- `openspec/changes/update-lock-and-watchdog/`
- `src/services/global-install.ts`, `src/services/install-check.ts`, `bin/omms-launch.mjs`
