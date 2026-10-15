# Tasks

## 1. Glyph tables and parity

- [x] 1.1 In the user's terminal, print the five glyphs `✔ ⧖ ↻ ✎ ✘` and confirm that none shows as a box and each takes one column. If one fails, stop and ask the user to approve `…` as the replacement.
- [x] 1.2 Add `tests/status-glyphs.test.ts` for the new shared module (full label per state, `web app off` and `not installed` keep their words, no U+FE0F in any label). Run it and confirm it fails. Then add `src/services/status-glyphs.ts` and confirm the test passes.
- [x] 1.3 Add `hooks/omms-status-glyphs.js` with the same table. Add `tests/status-glyph-parity.test.ts` that compares it with the shared module and checks the `warming` and `error` literals in `opencode/tui.tsx`. Change one glyph in one table and confirm the parity test fails, then restore it.

## 2. Pi footer

- [x] 2.1 Update the status expectations in `tests/pi-extension.test.ts` (lines near 484 to 557) to `omms: ⧖`, `omms: ✔`, `omms: ↻`, `omms: ✎`, `omms: ✘`. Confirm the tests fail on the old code.
- [x] 2.2 Replace both `` `omms:${status}` `` templates in `src/adapters/pi/extension.ts` with the shared label function. Confirm `bash scripts/run-tests-isolated.sh tests/pi-extension.test.ts` passes.
- [x] 2.3 Update the "Footer status" list in `docs/pi-adapter.md` with the glyph for each state. Check that the five states in the doc match the five in the spec.

## 3. OpenCode footer

- [x] 3.1 Update `tests/opencode-tui-status.test.ts` (lines 31 to 95) to `omms: ✔`, `omms: ✘ web app off`, `omms: ⧖` and `omms: ✔ · 4.3.0 available`. Confirm the tests fail on the old code.
- [x] 3.2 Change `tuiStatusText` in `src/adapters/opencode/tui-status.ts` to use the shared label function. Change the two literals in `opencode/tui.tsx` to the same labels. Confirm the OpenCode status test and the parity test pass.
- [x] 3.3 Update `docs/opencode-adapter.md` ("Footer status") and the OpenCode row of `docs/upgrading.md`. Grep `docs/` for `omms:connected`, `omms:warming` and `omms:web app off`, and confirm the only hits left are in `docs/adr/017-opencode-status-and-update-notice.md`.

## 4. Claude Code footer

- [x] 4.1 Update `hooks/omms-status.test.ts` so `last()` finds the label by `omms: ` without the dot, and the expectations read `⧖`, `✔`, `✘ web app off`, `✘ not installed`, and `focus · omms: ✔`. Keep the colour tests and the "never uses the plugin status row" test. Confirm the tests fail on the old module.
- [x] 4.2 Change `hooks/omms-status.jsx` to import the glyph table from `./omms-status-glyphs.js` and to draw `omms: <glyph>` with no dot. Keep `COLOURS` as it is.
- [x] 4.3 Run `bash scripts/test-claude-mod.sh` and confirm it passes. This script is outside `ci:local`.
- [x] 4.4 Update the intro paragraph and status table in `docs/claude-code-adapter.md` (label shape, rows, the "dot and state" wording). Grep the file for `●` and confirm no hit is left.

## 5. Integration

- [x] 5.1 Run `bun run ci:local` and `bash scripts/test-claude-mod.sh`. Both must pass.
- [x] 5.2 Run `bun run build` and `bun run check:package`. The npm package holds `dist/` and `opencode/` but not `hooks/`, so confirm `dist/services/status-glyphs.js` is in `npm pack --dry-run` and that `hooks/omms-status-glyphs.js` is tracked in the repository, where the Claude plugin loads it.
- [x] 5.3 Look at the real footer in Pi, OpenCode and Claude Code (`claude --plugin-dir` from this worktree). Confirm each state's glyph, colour and column width. Pause for the user if any glyph renders as a box or a colour emoji.
- [x] 5.4 Run `openspec validate status-glyphs --strict`, then `openspec-verify-change`, then run `graphify update .`.
