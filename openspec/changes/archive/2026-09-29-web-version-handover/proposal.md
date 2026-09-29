# Proposal: Hand the web port to a newer OMMS on `web install`

## Why

After an upgrade, the user runs `om-memory-system web install`. The command restarts the login item, but an older OMMS web app can still hold the port. On 2026-09-29, a manual `om-memory-system web` from 3.4.2 kept port 4747 after the 3.5.0 upgrade. The page showed the old version until the user found and stopped the process. OMMS already detects a version mismatch on the Settings page, but nothing makes the old web app give up the port.

## What Changes

- `om-memory-system web install` reads the version of the web app on the configured port before it starts the login item.
- When that web app is an older OMMS, `web install` asks it to step aside. It uses the local API token. The old web app stops serving, and the new login item takes the port.
- A web app that steps aside behaves by its kind. A standalone web app (`om-memory-system web` or the login item) exits. A web app inside an OpenCode session stops serving but keeps the session running, and does not take the port back for 60 seconds.
- A web app of the same or a newer version keeps the port. `web install` says which version holds it.
- An older web app without the step-aside route (3.5.0 and earlier) cannot be asked. `web install` names its version and says how to stop it.
- `web install` prints which version serves the port when it finishes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-autostart`: `web install` hands the port to the installed version when an older OMMS web app holds it.

## Impact

- **Code:** `src/cli/web-command.ts`, `src/services/web-server.ts` (a new token-protected step-aside route and a takeover hold-off), and a small version-compare module.
- **API:** a new `POST /api/web/step-aside` route. It needs the local API token and a loopback caller. `GET /api/settings/version` is unchanged and supplies the running version.
- **Compatibility:** the handover works only when the old web app has this change. Web apps from 3.5.0 and earlier get the message and the next step.
- **Hosts:** OpenCode is the only host that runs a web server inside its session, and it honours the step-aside request through the shared web server. Pi only registers the login item. No adapter changes.
- **Not in scope:** handover at host start or at every web server start (option 2b). A future change can build on the same route.
- **Docs:** `docs/cli.md` and `docs/web-ui.md`.
