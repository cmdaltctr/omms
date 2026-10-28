# TDR-058: The update button's npm found no node in a login item

- **ID:** TDR-058
- **Date:** 2026-10-28
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** web-update, npm, launchd, path

## Context

The web app's update button failed at once with "The update failed (npm-exit). The web app still runs." The log showed `exitCode: 127` after 6 to 8 milliseconds. A terminal `om-memory-system web update` worked on the same machine.

### Root Cause Analysis

The web app runs npm by its full path, beside its own Node.js (`npmBesideRuntime`). npm starts with `#!/usr/bin/env node`, so `env` looks for `node` on PATH. A macOS login item starts with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, and Homebrew's node is in `/opt/homebrew/bin`. `env` found no node and exited with 127, which means "command not found". A terminal has the full PATH, so the terminal command worked.

## Decision

- `npmSearchPath` in `src/services/web-update.ts` puts the folder of the web app's Node.js in front of PATH for npm. It returns that folder alone when PATH is empty.
- On Windows it changes nothing. `npm.cmd` runs the `node.exe` that is beside it.
- `nodeInstallDeps` in `src/services/web-update-runtime.ts` passes that PATH to the npm process. All other environment values stay the same.
- `tests/web-update-install.test.ts` checks the PATH for npm. `tests/web-update-runtime-path.test.ts` starts a real process and checks that it gets that PATH.

## Consequences

**Positive**

- The update button works in a login item, and so does `web update` when it runs with a short PATH.

**Negative**

- A web app that runs an older version still has the fault. Update it once with `om-memory-system web update` in a terminal.
