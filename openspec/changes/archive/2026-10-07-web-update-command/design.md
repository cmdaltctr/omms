# Design

## Context

- `om-memory-system web install` already talks to the web app on the port: `negotiateOwner` in `src/services/web-handover.ts` reads the version and sends `POST /api/web/step-aside`. The route refuses a caller that is not newer (`refused_not_newer`).
- The update button (`src/services/web-update.ts`, `WebUpdate`) runs `npm install -g` with the npm beside `process.execPath`, stops npm after 5 minutes, maps npm errors to codes (`npmFailureCode`), and checks the result with `globalCommandVersion`. The install runner is a private method.
- A standalone web app that cannot bind the port waits: `startHealthCheckLoop` in `src/services/web-server.ts` polls every 5 seconds, takes the port when it is free, and exits when the owner is newer (`ownerIsNewer`, through the step-aside callback). Only standalone web apps set that callback; a web app inside OpenCode does not.
- The power Restart (`src/cli/web-power.ts`) starts a fresh copy through the launcher (`~/.omms/bin/omms-launch.mjs web`) or restarts the login item with `restartWebAutostart`. It holds the start lock (`web-ensure.ts`) while no web app serves.
- `src/cli/index.ts` hands each command off to the newest recorded copy before it runs, so `web update` runs on the newest copy even when the global command is old.
- Live state on the author's machine: owner 4.10.0 (`web`, launcher), a waiting 4.10.0 login item, global install 4.4.1.

## Goals / Non-Goals

**Goals:**

- One command that ends with the global install on npm `latest` and exactly one fresh web app on the port.
- Reuse the existing install runner, step-aside route, launcher, login item restart, and start lock.
- Never kill a process by PID. Every web app stops itself after a request.

**Non-Goals:**

- No change to how hosts start or replace the web app.
- No change to the launcher's copy choice. `runtime.json` keeps an equal-version record, also when it names an `_npx` cache copy.
- No new HTTP route for the update. The command runs npm itself, so it also works when no web app runs.

## Decisions

### 1. The command runs npm itself

The command runs the shared install runner in its own process. Alternative: ask the running web app through `POST /api/web/update`. Rejected: that route only works when a web app runs, only when npm has a release newer than that web app, and not at all on web apps older than 4.10.0. The user's case had none of these conditions.

The runner moves out of `WebUpdate` into an exported function in `web-update.ts`, for example `runGlobalInstall(deps, target)`, which returns `{ code, exitCode }`. `WebUpdate.install` calls it. The tests for the button stay as they are and keep passing.

### 2. Replace the port owner with a forced step-aside

The step-aside body gains `replace: true`. With it, the route skips the "caller is newer" check. The loopback and token checks stay. The command sends it with its own version. Alternative: `POST /api/web/stop`. Rejected: Stop only exists on standalone web apps with a power callback, and it does not cover a web app inside OpenCode, which already handles step-aside safely (stops serving, keeps the session, holds off for 60 seconds).

An owner that predates `replace` ignores the flag and applies its old rule, so it steps aside when it is older than the command. A same-version or newer owner of that kind refuses, and the command reports it as stuck with the version and how to stop it. No separate plain request is needed.

### 3. Retire waiting web apps through a marker file

The command writes `~/.omms/web-retire.json` with `{ "before": <epoch ms> }` before it replaces the owner. In each 5-second loop, a standalone waiting web app reads the marker. When its own start time is earlier than `before`, it runs the step-aside callback and exits. A web app inside OpenCode has no callback and ignores the marker. The fresh web app starts after `before`, so it ignores the marker. The marker is written atomically (temp file and rename) and stays in place; a later `web update` overwrites it.

Alternatives considered:

- A PID registry and `SIGTERM`. Rejected: PID reuse can kill an unrelated process, Windows signal support differs, and the user asked that host sessions never die.
- An HTTP control channel per waiting web app. Rejected: a waiting web app holds no port.

### 4. Start the fresh web app the same way Restart does

- When the login item is installed: `restartWebAutostart`. On macOS `launchctl kickstart -k` also stops the old login item process, so a waiting login item never survives.
- Otherwise: spawn the launcher with `web`, detached, and `unref` it, as `web-power.ts` does. When the launcher is missing, spawn the newest copy's CLI from `runtime.json`.
- The command writes the start lock with its own PID before it replaces the owner and removes it when the fresh web app answers or the wait ends.

### 5. Wait for the fresh web app

The command polls `/api/health` and `/api/web/status` every 250 ms for up to 15 seconds. It accepts the first web app whose instance differs from the old owner's instance. When an older waiting web app took the port first (for example one that predates the marker), the command sends it a replace request once and keeps waiting.

### 6. Module layout

A new `src/cli/web-update-command.ts` holds the flow as one function with injected dependencies (fetch, sleep, now, npm runner, global version reader, spawn, login item state and restart, start lock, marker writer, log). `web-command.ts` only routes `update` to it. This keeps `web-command.ts` under its current size and lets the tests run the flow without a network, npm, or processes.

## Risks / Trade-offs

- [The first `web update` meets waiting web apps from 4.10.0 or earlier, which do not read the marker] → The login item restart stops a waiting login item. Any other waiting web app of the same version can take the port; the command then sends it a replace request. A 4.10.0 web app refuses that, so the command reports it as stuck once. After one release, every web app reads the marker.
- [npm under Homebrew or a system prefix needs permission] → The runner already maps `EACCES`/`EPERM` to `permission`. The command prints that code and the manual command.
- [A host starts a web app during the gap] → The start lock holds hosts off; a host that ignores a stale lock after 20 seconds starts a web app of the newest copy, which is the wanted result.
- [The marker file stays on disk] → It holds only a timestamp. A web app started later ignores it.

## Migration Plan

No data migration. Ship in a minor release. Rollback: revert the commit; the marker file and the `replace` flag are ignored by older versions.
