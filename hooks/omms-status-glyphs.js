// Footer glyphs for the Claude Code module. A twin of
// `src/services/status-glyphs.ts`: Claude Code modules cannot import from
// `src/`. `tests/status-glyph-parity.test.ts` keeps the two equal. This file
// imports nothing, so Bun can load it in that test.
//
// Each glyph is a one-column text symbol. Never append U+FE0F: it asks the
// terminal for a two-column colour emoji.

export const STATUS_GLYPHS = {
  warming: "⧖",
  connected: "✔",
  recalling: "↻",
  capturing: "✎",
  error: "✘",
};

/** States that need an action keep their words after the error glyph. */
export function ommsStatusLabel(state) {
  if (state === "web app off" || state === "not installed") {
    return `omms: ${STATUS_GLYPHS.error} ${state}`;
  }
  return `omms: ${STATUS_GLYPHS[state]}`;
}
