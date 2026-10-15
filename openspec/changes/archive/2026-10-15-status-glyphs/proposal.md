# Proposal

## Why

Each host footer shows OMMS state as a word: `omms:connected`, `omms:warming`, `omms:recalling`. The word is long, and it is the same on every host only by accident. Claude Code adds a coloured dot and a space (`● omms: connected`), while Pi and OpenCode show no space. A short glyph after `omms:` is faster to read, takes less footer width, and lets all three hosts use one vocabulary.

## What Changes

- The footer label on every host becomes `omms: <glyph>`, with one space after the colon.
- The glyphs are single-column Unicode text symbols, not colour emoji:

  | State               | Glyph |
  | ------------------- | ----- |
  | connected           | `✔`   |
  | warming, connecting | `⧖`   |
  | recalling           | `↻`   |
  | capturing           | `✎`   |
  | error               | `✘`   |

- States that need an action keep their words after the glyph: `omms: ✘ web app off` and `omms: ✘ not installed`.
- The update suffix is unchanged: `omms: ✔ · 4.4.0 available`.
- Claude Code drops the `●` dot. The glyph takes the state colour (green, yellow, red) that the dot and word have today. `✔` is never yellow and no state uses `⚠`.
- Pi gains a requirement that names its footer states. Today no spec states them.
- Pi and OpenCode footer text changes from `omms:connected` to `omms: ✔`. This is a visible text change but not an API change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-code-adapter`: the footer label requirement and the update-notice requirement change their text from `● omms: <state>` to `omms: <glyph>`. Colour rules stay.
- `opencode-v2-adapter`: the footer status requirement and the update-notice requirement change their text from `omms:<state>` to `omms: <glyph>`.
- `pi-agent-adapter`: adds a footer status requirement that lists the five states and their glyphs.

## Impact

- Code: `src/adapters/pi/extension.ts`, `src/adapters/opencode/tui-status.ts`, `opencode/tui.tsx`, `hooks/omms-status.jsx`. One new pure module in `src/services/` for Pi and OpenCode, and one plain `.js` twin in `hooks/` for the Claude Code module.
- Tests: `tests/pi-extension.test.ts`, `tests/opencode-tui-status.test.ts`, `hooks/omms-status.test.ts`, plus a new test that keeps the two glyph tables equal.
- Docs: `docs/pi-adapter.md`, `docs/opencode-adapter.md`, `docs/claude-code-adapter.md`, `docs/upgrading.md`. ADR-017 records history and stays as written.
- No config, API, storage, or dependency change. No new setting.
- Risk: a terminal font without a glyph shows an empty box. `⧖` has the weakest font coverage. See `design.md`.
