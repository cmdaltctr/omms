## Context

Three hosts draw the OMMS footer label with three separate code paths. See `proposal.md` for the reason to change it.

- Pi builds `` `omms:${status}` `` in two places in `src/adapters/pi/extension.ts`.
- OpenCode builds the text in `tuiStatusText` in `src/adapters/opencode/tui-status.ts`. The TUI entry `opencode/tui.tsx` also holds two literals, `omms:warming` and `omms:error`, because it must draw before its dynamic `import()` of `dist/` finishes.
- Claude Code draws `● omms: {state}` in `hooks/omms-status.jsx`. That module runs inside Claude Code and cannot import from `src/`. Claude Code's own plugin API, not OMMS, sets this limit.
- `src/core/` and `src/services/` may not import adapters or read `CONFIG` directly. A shared helper must be a pure function.

## Goals / Non-Goals

**Goals:**

- One glyph vocabulary on all three hosts.
- A test that fails when the vocabulary drifts between hosts.
- Single-column text symbols that follow the footer colour.

**Non-Goals:**

- No new setting. There is no ASCII fallback switch.
- No change to when states change, to polling, to the update check, or to toasts.
- No change to Claude Code colours. Only the dot goes.
- No host registry. The refactor named in `CLAUDE.md` stays out of this change.

## Decisions

**1. Glyph set: `✔ ⧖ ↻ ✎ ✘`.**
The user asked for a symbol that is neither an icon nor an emoji. These are Unicode text symbols. Each has text presentation by default, so a terminal draws it in one column in the footer colour. `✔` is U+2714, `⧖` U+29D6, `↻` U+21BB, `✎` U+270E, `✘` U+2718. The code appends no variation selector U+FE0F, because that selector would ask for emoji presentation.
Alternatives rejected: `⏳` and `⌛` (colour emoji in most terminals, two columns wide, which breaks footer alignment), `…` (safer font coverage but weak as a "waiting" sign, kept as the fallback if `⧖` shows as a box).
The user did not pick a set when asked. This set is the proposed one. A change to it edits two tables and the docs, with no change to structure.

**2. Words stay on the two action states.**
`omms: ✘ web app off` and `omms: ✘ not installed` keep their words. A bare `✘` cannot say what to fix, and the docs table tells the user what to do for each word. The generic error state on Pi and OpenCode has no action, so it is a bare `✘`.

**3. Pi and OpenCode share one pure module; Claude Code gets a twin.**
New `src/services/status-glyphs.ts` exports the glyph table and a function that returns the full label for a state. Pi and OpenCode import it. It reads no config, so mocks of `src/config.ts` do not affect it.
Claude Code cannot import `src/`. Put its table in `hooks/omms-status-glyphs.js`, a plain file with no Claude Code import, next to `omms-recall-parse.js`, which `omms-recall.jsx` already imports the same way. A new test in `tests/` imports both tables with Bun and fails if they differ. Because it is plain JavaScript, Bun can load it, unlike the `.jsx` modules.
Alternatives rejected: duplicate inline in each host (drift goes unseen), generate the hook file at build time (a build step for five lines).

**4. `opencode/tui.tsx` keeps two literals.**
It cannot import the shared module before its `import()` resolves. The same parity test reads `opencode/tui.tsx` as text and checks that the warming and error literals equal the shared labels.

**5. Claude Code: glyph takes the colour, dot goes.**
`COLOURS` in `hooks/omms-status.jsx` stays as it is. The `<Text color>` run wraps `omms: <glyph>` plus any state words. The spec rule that `connected` is never yellow and never `⚠` stays, and a test covers it.

**6. Pi: space after the colon.**
Today Pi and OpenCode print `omms:connected` with no space. All three hosts now print `omms: ` with a space, as the request wrote it.

## Risks / Trade-offs

- [A font lacks a glyph and the footer shows a box] → Task 1.1 prints all five glyphs in the user's terminal and in each host before any code change. If `⧖` fails, switch the table to `…` and amend the spec. Any later change is a two-table edit.
- [A terminal draws `✔` or `✘` as a colour emoji] → No variation selector is appended, so text presentation applies. The live check in task 5.3 confirms it.
- [The Claude Code tests are outside `ci:local`] → Task 4.3 and task 5.1 run `bash scripts/test-claude-mod.sh` by hand. It needs `claude` 2.1.295 or later.
- [Users who parse the footer text break] → No documented interface reads the footer. The release is a `feat:` commit and the changelog states the new text.
- [Width in non-Latin fonts] → All five glyphs are expected to take one column. The live check watches for misaligned footers.

## Migration Plan

No data or config migration. Ship with the next release. Rollback is a revert of the commit.
