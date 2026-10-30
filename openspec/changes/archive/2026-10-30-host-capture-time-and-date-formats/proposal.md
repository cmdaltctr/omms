# Proposal

## Why

The host cards on `/memory` read `Running · last import 19 Oct`. That date is the one-off history import, so users think new chats stopped being saved on that day, while live capture saves every day. Dates and times also follow one fixed style per page language, with no 24-hour clock. Some dropdowns with short options stretch across the full width, which makes forms look emptier and harder to scan.

## What Changes

- Each host card shows when live capture last saved a memory, for example `Running · history imported 19 Oct · last saved today 18:52`. The history part is renamed from `last import` to `history imported`.
- The web app reads the last live save per host from the capture records that OMMS already keeps. No new tracking is added.
- A new **Appearance** settings section holds a theme chooser and the date and time formats. The theme chooser offers System, Light and Dark, and a light and a dark theme from the 58 OpenChamber palettes plus the OMMS default, as in OMRS v3. The sidebar theme button keeps working.
- In the Appearance section the user can choose a date format and a time format (12-hour or 24-hour). Every date and time in the web app uses the choice. The choice is stored in the browser, like the page language and theme.
- Dropdowns with short options get a fixed comfortable width instead of the full row: Scope (Sessions), Provider (External API), Memory language and the embedding Preset. Model pickers keep the full width because model IDs are long.

## Capabilities

### New Capabilities

- `web-date-time-format`: the user's date and time format choice and where it applies.
- `web-theme-choice`: the theme mode and the chosen light and dark themes.

### Modified Capabilities

- `web-memory-hosts`: the host card status line shows the history import date with the new wording and the last live save.
- `web-visual-design`: dropdowns with short options use a compact width.

## Impact

- Server: one read-only query on `capture_attempts` in `user-prompts.db`, and one new loopback API route.
- Web: `theme.ts`, `document-head.ts`, a theme catalogue copied from OMRS v3 (generated from OpenChamber, MIT), `host-status.ts`, `use-host-statuses.ts`, `format.ts`, a new settings section, the date call sites in about 10 components, four dropdown call sites, translations in English, Chinese and Arabic.
- Docs: `docs/web-ui-memory.md`, `docs/web-ui-settings.md`.
- No change to capture, import or stored memories.
