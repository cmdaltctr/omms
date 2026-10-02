# Proposal

## Why

OpenCode showed no sign that OMMS was loaded, while Pi shows its state in the footer. OpenCode also never checks npm for a newer OMMS after it caches a copy, so users ran 3.6.2 after 4.2.0 shipped. That cached copy also rewrote the login item to an old version. Two small Settings defects remained: "1 sessions" and confidence badges with a decimal place.

## What Changes

- OpenCode shows `omms:connected` in its prompt footer, or `omms:web app off` when the web app does not answer, like Pi.
- When npm has a newer OMMS release, the OpenCode footer adds `· <version> available` and a toast names `opencode plugin update om-memory-system`. The check runs at start and every 6 hours. `OMMS_DISABLE_UPDATE_CHECK=1` turns it off.
- The login item keeps the newest of three OMMS copies: the copy that installs it, the global install beside the runtime, and the copy the item already runs. An older host cache can no longer downgrade it.
- The Settings page says "1 session", and profile confidence badges show whole numbers.
- New `UPDATES.md` explains how OpenCode, Pi, Claude Code, and the web app get updates.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-v2-adapter`: footer status and update notice.
- `web-autostart`: the login item keeps the newest OMMS copy.
- `web-settings`: singular wording and whole-number confidence.

## Impact

- New: `src/adapters/opencode/tui-status.ts`, `opencode/tui.tsx` (`./tui` package export), `UPDATES.md`.
- Changed: `src/services/web-autostart.ts`, `package.json` (`files`, exports), `scripts/verify-package.mjs`, Settings and profile components, `web/src/lib/i18n/settings.ts`, docs.
- Network: one GET of `https://registry.npmjs.org/om-memory-system/latest` and the local health route. No session content is sent.
- Host parity: Pi already shows its status and update notice.
