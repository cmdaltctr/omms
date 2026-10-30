# Tasks

## 1. Last live save

- [x] 1.1 Add `lastLiveSaves()` to `capture-attempt-store.ts`, with a test that counts only saved live captures per host. Verify the test fails before the function exists.
- [x] 1.2 Add `GET /api/settings/last-saved`, with a route test for the response shape and the token rule.
- [x] 1.3 Change `cardLine` to `Running · history imported {date} · last saved {when}`, with tests for each scenario in the `web-memory-hosts` delta. Load the route in `use-host-statuses.ts` on mount, on a settings snapshot and every 60 seconds.

## 2. Date and time format

- [x] 2.1 Add the format store and `formatDateTime`, `formatDay`, `formatTime` to `format.ts`, with tests for every date option, both clocks, Automatic and an unknown stored value.
- [x] 2.2 Add the **Appearance** settings section after Memory language, with a **Date and time** card that shows an example on each option. Add the section to `SETTINGS_SECTIONS`.
- [x] 2.3 Move every date and time call site listed in the spec to the format module. Verify with a grep that no `toLocaleString`, `toLocaleDateString` or `toLocaleTimeString` call on a date remains in `web/src`.

## 3. Theme chooser

- [x] 3.1 Add the theme catalogue (OMMS default pair plus the OpenChamber themes from OMRS v3, with credit) and a pure `themeStylesheet(lightId, darkId)` that maps theme colours to OMMS tokens. Test that the default pair adds no rule, that an unknown id falls back to the default, and that every theme sets every token.
- [x] 3.2 Store the mode and the light and dark theme ids in the browser. `System` clears the saved mode. Apply the stylesheet and the `theme-color` meta on load and on change. Test with a reload and an unknown stored id.
- [x] 3.3 Add the **Theme** card to Appearance: System, Light and Dark choices, a filter box, and a light and a dark list with swatches. Keep the sidebar theme button in step.

## 4. Compact dropdowns

- [x] 4.1 Give Scope, Provider, Memory language, embedding Preset and the new format dropdowns the compact width. Verify in the browser at 1280 px and 390 px.

## 5. Text, docs and gate

- [x] 5.1 Add every new string in English, Chinese and Arabic. Verify with `tests/web-translations-parity.test.ts`.
- [x] 5.2 Update `docs/web-ui-memory.md` and `docs/web-ui-settings.md`.
- [x] 5.3 Browser check with synthetic data at 1280 px and 390 px, light and dark, English and Arabic.
- [x] 5.4 Run `bun run ci:local` and `openspec validate host-capture-time-and-date-formats --strict`. Both pass.

## Workflow follow-up

- Archive the change before the pull request.
