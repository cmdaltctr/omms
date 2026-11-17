/**
 * Footer label for the Pi and OpenCode adapters. Claude Code cannot import
 * from `src/`, so `hooks/omms-status-glyphs.js` holds a twin of this file and
 * `tests/status-glyph-parity.test.ts` keeps the two equal.
 *
 * Each glyph is a one-column text symbol. Never append U+FE0F: it asks the
 * terminal for a two-column colour emoji.
 */
export const STATUS_GLYPHS = {
  warming: "⧖",
  connected: "✔",
  recalling: "↻",
  capturing: "✎",
  error: "✘",
} as const;

export type StatusGlyphState = keyof typeof STATUS_GLYPHS;

/**
 * States that need an action keep their words after the error glyph. `capture off`
 * keeps the connected glyph: the web app runs, but Claude Code capture needs setup.
 */
export type StatusWordState = "web app off" | "not installed" | "capture off";

export function ommsStatusLabel(state: StatusGlyphState | StatusWordState): string {
  if (state === "web app off" || state === "not installed") {
    return `omms: ${STATUS_GLYPHS.error} ${state}`;
  }
  if (state === "capture off") return `omms: ${STATUS_GLYPHS.connected} ${state}`;
  return `omms: ${STATUS_GLYPHS[state]}`;
}
