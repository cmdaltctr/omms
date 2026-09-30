# Design

## Context

See proposal.md for the motivation. Current state:

- **OpenCode** (`src/index.ts`) calls `startWebServer` inside the plugin process when `webServerEnabled` is `true` and the store is ready. It shows toasts for start, takeover, and exhausted ports. It registers OpenCode's models for the web backend (`registerOpencodeHostModels`) and the OpenCode Retry now drain, which only this in-process server can use.
- **Pi** (`src/adapters/pi/extension.ts`) calls `reconcileWebAutostart` only. It never starts a web app.
- **Claude Code** (`src/adapters/claude-code/hook-client.ts`, `ensureServer`) probes `GET /api/health`, checks the OMMS reply shape, spawns a detached `om-memory-system web` with `resolveWebRuntime()`, and polls within a per-event budget.
- **Login item** (`src/services/web-autostart.ts`) is on by default (`webServerAutoStart: true`). It runs `web --login-item`, with `KeepAlive: false` on macOS and no `Restart=` in the systemd unit. It usually holds the port before OpenCode starts, so the OpenCode in-process server already waits as a non-owner for most users.
- **Web server** (`src/services/web-server.ts`) has `POST /api/web/step-aside` (loopback and token), `setOnStepAside`, port takeover, and fallback ports.
- The Import section reads `importReadiness()` (`src/importer/import-readiness.ts`), which reports `opencode.available` from the registered host models. The Health page calls `getOpencodeHostModels()` and throws "the OpenCode client is not ready" without them.

## Goals / Non-Goals

**Goals:**

- One place decides whether to start the web app. Each host calls it with one line.
- Never two web apps on one machine from concurrent host starts.
- Every host brings a stopped web app back at its next start.
- A power button with one behaviour, because only one kind of web app exists.

**Non-Goals:**

- A standalone OpenCode import reader. That is a later change.
- Handing the port from an older web app to a newer one at host start. `web install` does that (`web-version-handover`).
- Removing the step-aside no-callback path. An OpenCode session with an older plugin still runs an in-process server.
- Turning the web app on from the page.

## Decisions

### 1. `ensureWebApp()` in `src/services/web-ensure.ts`

One exported function:

```ts
ensureWebApp(options: {
  budgetMs: number;          // how long the caller may wait for an answer
  wait?: boolean;            // false: start and return at once (session starts)
  deps?: Partial<EnsureDeps>; // fetch, spawn, sleep, now, fs, resolveRuntime, cliScript, pidAlive
}): Promise<"running" | "started" | "disabled" | "port-busy" | "no-runtime" | "start-timeout">
```

Steps:

1. If `webServerEnabled` is `false`, return `disabled`.
2. Probe `GET /api/health` on the configured URL. The OMMS reply is `{ success: true, status: "ok" }`, the check the hook uses today. An OMMS answer returns `running`.
3. Any other answer on the port (a non-OMMS program) returns `port-busy` and logs a code. The function never starts a web app on another port, so no copy slides to a fallback port that no client asks for.
4. Take the start lock: create `~/.omms/web-start.lock` with exclusive create (`wx`). It holds the pid and the time. A lock is stale when its pid is not alive or it is older than 20 seconds. A stale lock is removed and the create is tried once more.
5. With the lock, probe again, then spawn one detached `om-memory-system web` (`detached: true`, `stdio: "ignore"`, `cwd` home, `unref()`), with the runtime from `resolveWebRuntime()` and the package's own `dist/cli/index.js`.
6. Without the lock, do not spawn. Poll health until the budget ends.
7. With `wait: true`, poll health every 250 ms within the budget, then release the lock and return `started` or `start-timeout`. With `wait: false`, release the lock once the first health answer arrives or after 20 seconds, in the background, and return `started`.

Pure logic and injected dependencies keep it testable. It imports nothing from adapters. It reads `CONFIG` through an argument, as `CLAUDE.md` asks for new pure logic, so config stubs in other tests are not affected.

Alternative: a port bind as the lock. Rejected. The spawned child binds the port, not the caller, and a bind check races with the child's own start.

### 2. Host calls

- **OpenCode:** replace the `startWebServer(...)` block with `void ensureWebApp({ budgetMs: 10_000 })` inside the same `webServerEnabled && tursoReadyForWeb` guard. It shows one toast: "Web UI available at <url>" when the result is `running` or `started`, and an error toast for `port-busy` or `no-runtime`. The takeover and exhausted-port toasts go away. `registerOpencodeImportModels()` and the OpenCode capture-retry drain stay, because the in-process backfill and capture still use them. They only stop reaching the web page.
- **Pi:** add `void ensureWebApp({ budgetMs: 0, wait: false })` in `session_start`, next to `reconcileWebAutostart`, under the same `OMMS_DISABLE_WEB_AUTOSTART` guard used in tests.
- **Claude Code:** `ensureServer` calls `ensureWebApp({ budgetMs, wait: true })` and maps the result to its existing codes (`ok`, `server-unreachable`, `start-timeout`). Its private spawn and poll code goes away.

Each host call is one line plus its existing guard.

**OpenCode profile learning and cleanup.** `session.idle` in `src/index.ts` ran profile learning and the daily cleanup only when `webServer?.isServerOwner()` was true. With no in-process server that check can never pass, so both would stop. Remove the check. Both run on every OpenCode `session.idle`, after capture, the same way Pi and Claude Code run profile learning in each session. Cleanup keeps its in-process daily limit (`shouldRunCleanup`). Chosen over moving cleanup into the standalone web app, which is a larger change and stays a follow-up.

### 3. What the page loses, and the page changes

The web process never has OpenCode's host models now. The code already reports this in most places:

- **Import section:** `importReadiness().opencode.available` is `false`. Change the reason text to say that imports with an OpenCode signed-in model run from the terminal or with `/import` in OpenCode. Offer only the external API.
- **Health page:** mark the OpenCode model test `skipped` with the same reason, not `fail`. This needs a `skip` status in the health row, or `warn` with the reason if the page has no skip style. Decide in implementation by the smallest page change; record it in the change notes.
- **Run now and Retry now:** the existing messages already name the next step. No change.

### 4. Power control routes

- `GET /api/web/status` returns `{ version, canControl }`. `canControl` is true only for a loopback peer. The token gate covers it.
- `POST /api/web/stop` and `POST /api/web/restart`: loopback first (`403`), then the token (`401`), then `202`, then act after the reply with the same short grace delay as step-aside.
- `WebServer` gets `setOnPowerAction(callback: (action: "stop" | "restart") => void | Promise<void>)`. Without a callback (an old-style in-process server), both routes reply `409` with "not supported". Only `runWebCommand` registers the callback.
- Log one record per request: outcome (`stopping`, `restarting`, `refused_auth`, `refused_not_loopback`, `unsupported`) and own version. Never the token.

### 5. Stop and Restart in the standalone command

- **Stop:** stop the server and exit with code `0`.
- **Restart, login item (`--login-item`):** stop the server, then `launchctl kickstart -k gui/<uid>/<label>` on macOS or `systemctl --user restart omms-web.service` on Linux, through the command runner in `web-autostart.ts`. A detached child would die with the launchd job or the systemd control group. If the command fails, fall back to the detached copy.
- **Restart, otherwise (by hand or started by a host):** stop the server, spawn a detached copy of `process.execPath` with the same arguments, write the start lock with the copy's pid, and exit with code `0`. A hand-started copy loses its terminal. The docs say so.

### 6. Page behaviour

- `PowerButton` in the sidebar footer calls `GET /api/web/status` on load and every 15 seconds. It renders only when `canControl` is true. Green when the last call succeeded, grey when it failed.
- The dialog focuses Restart. Under Stop it says the next OpenCode start, Pi start, Claude Code prompt, `web install`, or login starts the app again.
- After Restart: poll `GET /api/health` every 500 ms for up to 20 seconds, then reload. On timeout, show the stopped screen.
- After Stop: show a full-page stopped screen with `om-memory-system web` and the same note. No further API call.

### 7. ADR-014

Record the decision in `docs/adr/014-one-shared-web-app-for-every-host.md` and add it to `docs/adr/ADR_README.md`: one standalone web app, one shared start module with a lock, OpenCode drops the in-process server, what the page loses, and the follow-up import reader.

## Risks / Trade-offs

- [OpenCode users who turned the login item off lose page imports and model tests with OpenCode's models] → The page names the terminal and `/import`. ADR-014 and the docs record it. A follow-up change can add a standalone reader.
- [A spawned web app runs the plugin's own package version, which can differ from the global command] → Hosts use whatever answers. `web install` hands the port to a newer version.
- [Lock file left by a crash] → Stale after the pid dies or after 20 seconds.
- [Two different OMMS versions start at once] → Both use the same lock path, so one starts.
- [A hook fires during a Restart] → For a detached restart, the old process writes the start lock with the new copy's pid before it exits, so a hook waits and does not spawn. The web server removes the lock when it becomes the owner and the lock names its own pid. For a login-item restart the pid is unknown, so a hook may spawn a second copy. The takeover rule leaves one owner, and the other copy waits as a non-owner.
- [Two OpenCode windows now both run profile learning and cleanup] → Cleanup deletes by age, so a second run does nothing new. Profile learning marks each prompt as learned and its profile update retries on a version conflict, so two windows can at worst analyse the same waiting prompts twice. Accepted; a shared lock is a follow-up if it shows up in practice.
- [Tests that expect the OpenCode plugin to start a server] → Task 3.4 finds and updates them.
- [Any local process with the token can stop the app] → Same exposure as step-aside: user-only token file, loopback only, no data changes.

## Migration Plan

No data or config changes. After upgrade, the next OpenCode start uses or starts the standalone web app. An older in-process server keeps its port until it stops or steps aside. Roll back by reverting the host calls; the login item and takeover rules stay.

## Open Questions

None. Assumptions: 20-second lock staleness, 15-second status poll, and 20-second restart wait are enough for a local loopback app. They are constants.
