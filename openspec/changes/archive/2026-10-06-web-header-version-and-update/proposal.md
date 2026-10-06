# Proposal

## Why

The web page does not show which OMMS version serves it. A user who restarts the web app cannot see whether the new version took over. The web page also gives no sign when npm has a newer release. The Claude Code status line and the OpenCode footer show this notice, but a user who works only in the browser never sees it. Updating then needs a terminal command for each host.

## What Changes

- The sidebar header shows the product name as `OMMS` in the brand green `#678D6C`, followed by the running version (for example `v4.9.0`) in a smaller font and the normal text colour.
- The version comes from `GET /api/web/status`. After a restart onto a new copy, the label shows the new version without a page reload.
- The web app checks npm `latest` at start and then every 6 hours. `OMMS_DISABLE_UPDATE_CHECK=1` turns the check off, as on the other hosts.
- When npm `latest` is newer than the running version, the sidebar footer shows an **Update** button: the word next to the GitHub link in the open sidebar, an icon in the collapsed sidebar, and its own row on a phone. The update button shows only to a caller that may control the web app.
- The update button opens a dialog with:
  - the update command for each host (Claude Code, OpenCode, Pi, and the global command), each with a copy button.
  - an **Update web app** action. It installs the new release globally with the npm that runs beside the web app's Node.js, then restarts the web app onto the new copy through the OMMS launcher.
- New route `POST /api/web/update`. It has the same guards as Restart: loopback caller and local API token. `GET /api/web/status` reports the update state, so the page can show progress and failures.
- A failed install leaves the running web app as it is and shows a failure code in the dialog. The log holds codes only, never npm output.

## Capabilities

### New Capabilities

- `web-sidebar-header`: the product name and the running version in the web page's sidebar header.
- `web-update`: the npm release check in the web app, the update notice in the page, and the one-click update of the global install with a restart onto the new copy.

### Modified Capabilities

None. The restart that `web-update` starts uses the launcher, and leaves the Restart requirements in `web-power-control` unchanged.

## Impact

- `web/src/lib/components/explorer/AppSidebar.tsx`, `PowerButton.tsx`, a new update button and dialog component, `web/src/lib/i18n/translations.ts` (`en`, `zh`, `ar`), `web/src/app.css` (brand token).
- `src/services/web-server.ts`: status fields, `POST /api/web/update`.
- New `src/services/web-update.ts`: npm check schedule, install runner, state.
- `src/cli/web-power.ts`: a restart that runs the launcher in place of the current copy.
- Reuses `src/services/update-check.ts`, `src/services/runtime-record.ts` (`launcherPath`, `copyVersion`), and `src/services/global-version.ts`.
- Docs: `docs/web-ui.md`, `docs/upgrading.md`, `UPDATES.md`.
- Builds on the restart handoff fix on branch `fix/restart-handoff`. That fix should merge first.
