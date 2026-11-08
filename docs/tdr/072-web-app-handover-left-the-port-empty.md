# TDR-072: The web app handover left the port empty and the global install behind

**Date:** 2026-11-08
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** web-app, update, launcher

## Context

The 5.9.0 release showed three faults on one machine. Each host updated itself, and the web app at `http://127.0.0.1:4747` did not answer for about 3 minutes. Afterwards, the web app ran from the OpenCode cache copy. The global install stayed on 5.8.0.

### Root Cause Analysis

1. **Empty port.** An OpenCode session on 5.9.0 asked the 5.8.0 login item to step aside. The login item exited at once. The caller must then start the newest copy, but it never did. The log shows no start between 19:32:14 and 19:35:16. A Claude Code `SessionStart` started the web app at 19:35:16.
2. **Global install behind.** The automatic install compared npm `latest` with the running copy only. The running copy came from the OpenCode cache and was already 5.9.0, so `npm install -g` never ran.
3. **Cache copy kept serving.** On a tie, the launcher ran the first candidate, the copy in `~/.omms/runtime.json`. A global install of the same version therefore never replaced the host cache copy.

## Decision

1. `src/cli/web-step-aside.ts`: after a standalone web app steps aside, it waits up to 30 seconds for a new owner. If none answers, it restarts onto the newest copy through the launcher (`powerAction("update")`). If that fails and the port is still empty, it serves again.
2. `src/services/web-update.ts`: the check compares npm `latest` with the older of the running copy and the global install.
3. `bin/omms-launch.mjs`: `findCandidates` lists the global installs before the recorded copy, so the global install wins a tie.

## Consequences

### Positive

- A caller that quits during a handover no longer leaves the port empty.
- The global command and the login item follow npm without a manual `npm i -g`.

### Negative

- After a step-aside, the old web app process lives up to 30 seconds longer.
- A web app on a current host copy restarts once, after it updates a global install that was behind.

### Neutral

- Web apps from 5.9.0 or earlier keep the old behaviour until they are replaced.

## Alternatives Considered

| Option                                         | Rejected Because                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Old app restarts through the launcher at once  | It races the caller's own start and leaves a second copy waiting for the port. |
| Caller keeps a detached watchdog               | The caller is the process that died; a watchdog in it has the same weakness.   |
| Always run `npm i -g` from hosts after updates | Hosts must not change a global install the user did not ask them to touch.     |
