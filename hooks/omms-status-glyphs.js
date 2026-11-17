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

/**
 * States that need an action keep their words after the error glyph. `capture off`
 * keeps the connected glyph: the web app runs, but Claude Code capture needs setup.
 */
export function ommsStatusLabel(state) {
  if (state === "web app off" || state === "not installed") {
    return `omms: ${STATUS_GLYPHS.error} ${state}`;
  }
  if (state === "capture off") return `omms: ${STATUS_GLYPHS.connected} ${state}`;
  return `omms: ${STATUS_GLYPHS[state]}`;
}
