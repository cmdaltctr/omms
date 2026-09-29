# Design

## Context

`om-memory-system web install` writes `webServerAutoStart: true`, installs the login item, and starts it (`installWebAutostart({ start: true })` in `src/services/web-autostart.ts`). On macOS it runs `launchctl bootout` and `bootstrap`. On Linux it runs `systemctl --user start`, which does nothing when the service already runs.

The web server has a port-ownership rule. A server that finds the port held by a healthy OMMS waits as a non-owner and checks every 5 seconds. It takes the port only when the owner stops answering. TDR-015 fixed the Node path, so this rule now works for the login item too. The rule never asks an owner to leave, so an older owner keeps the port for as long as it runs.

`GET /api/settings/version` already returns `{ running, global, mismatch }`. It needs the local API token (`~/.omms/.auth-token`, header `x-omms-token`). It exists in 3.5.0, so `web install` can read the version of a 3.5.0 owner.

## Goals / Non-Goals

**Goals:**

- After `web install`, the installed version serves the port whenever an older OMMS held it and can step aside.
- Tell the user what holds the port when OMMS cannot hand it over.
- Never stop a web app of the same or a newer version.

**Non-Goals:**

- Handover when a host session or any web server starts (option 2b).
- Stopping web apps from 3.5.0 and earlier. They have no step-aside route, and OMMS does not kill processes by PID.
- Handover for a non-OMMS service on the port. The existing fallback-port rule covers that.

## Decisions

### 1. Read the owner's version through the existing route

`web install` calls `GET /api/settings/version` on the configured URL with the local token and a 2-second timeout. It uses `running` from the reply.

- No answer: nothing holds the port. Install as today.
- A reply without `running`, or a non-OMMS reply: install as today and print the existing URL line. The fallback-port rule decides the port.
- `401` from an owner with `webServerApiToken` set: use that configured token, as `web status` does.

### 2. Compare versions in a pure module

A new `src/services/version-compare.ts` exports `compareVersions(a, b)`. It follows SemVer order, so a prerelease such as `3.5.0-next.33` is older than `3.5.0`. `unknown` or an unparseable version compares as "not older", so OMMS never stops a web app it cannot place. The module imports nothing from `src/config.ts`.

### 3. A step-aside route on the web server

`POST /api/web/step-aside` needs a loopback remote address and the local API token, checked the same way as other `/api/` routes. The body is `{ "version": "<caller version>" }`. The server refuses with `409` when the caller's version is not newer than its own. This check protects a newer owner from an older `web install`. Otherwise it replies `202` and steps aside after the reply is sent.

`WebServer` gets `setOnStepAside(callback)`:

- The standalone command (`runWebCommand` without an action, including `--login-item`) registers a callback that stops the server and exits with code `0`.
- Without a callback (inside an OpenCode or Pi session), the server stops serving, becomes a non-owner, and starts its health loop after a 60-second hold-off. The session keeps running. Under the existing rule it takes the port back only when no OMMS answers after that.

### 4. Install order

1. Read the owner's version (decision 1).
2. If the owner is older, send the step-aside request. If the route returns `404`, print that OMMS `<version>` holds the port and how to stop it. Then install the item and exit with code `0`. The item waits as a non-owner and takes the port once the old one stops.
3. After `202`, poll the port every 250 ms for up to 10 seconds until nothing answers. If it still answers, print the same message as the `404` case.
4. Install and start the login item as today.
5. Poll the version route for up to 10 seconds, then print `OMMS web app: <url> (version <v>)`. If a different version answers, say so.

On Linux, a step-aside exit also stops an older `omms-web.service`, so `systemctl --user start` then starts the new one.

### 5. Messages

`web install` prints plain lines, one of:

- `OMMS web app: http://127.0.0.1:4747 (version 3.6.0)`
- `OMMS 3.5.0 holds port 4747 and cannot hand it over. Stop that web app (Ctrl+C in its terminal, or quit the session that runs it), then run om-memory-system web install again.`
- `OMMS 3.7.0 already serves port 4747. It is newer than this command (3.6.0). Update the global command: npm i -g om-memory-system`

### 6. Logging

The web server logs one record for each step-aside request: the outcome (`stepped_aside`, `refused_not_newer`, `refused_auth`), its own version, and the caller's version. It never logs the token.

## Risks / Trade-offs

- [An old owner inside a session takes the port back before the new login item binds] → The 60-second hold-off, and `web install` starts the item only after the port is free.
- [Any local process with the token can stop a standalone web app] → The token file is readable only by the user, and the route stops serving only. No data changes. Loopback only.
- [Owners from 3.5.0 and earlier stay] → The message names the version and says how to stop it. Handover starts to work from the first release with this change.
- [Clock or network delays make the 10-second poll too short] → The item still takes the port later through the existing takeover rule.

## Migration Plan

No data or config changes. Rolling back removes the route and the install steps. The login item and takeover rule are unchanged.
