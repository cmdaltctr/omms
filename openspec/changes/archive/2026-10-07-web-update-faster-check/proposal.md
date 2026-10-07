## Why

After 4.13.0 was approved on npm, Pi and OpenCode showed the update, but the web app showed nothing. The web app read npm `latest` at start and then every 6 hours, so a release could wait up to 6 hours for its update button.

## What Changes

- The web app reads npm `latest` at start and every 10 minutes.
- When an open page reads `GET /api/web/status` and the last check is more than a minute old, the web app starts a new check in the background. A release then shows within about a minute while the page is open.
- Reads that arrive during a check share it, so npm gets one request.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-update`: the check interval and the check on status reads.

## Impact

- `src/services/web-update.ts`, `tests/web-update-check.test.ts`, `docs/web-ui.md`.
- About 6 npm registry requests an hour in the background, plus at most one a minute while a page is open. `OMMS_DISABLE_UPDATE_CHECK=1` still stops all of them.
