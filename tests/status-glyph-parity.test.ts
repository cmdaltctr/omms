import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ommsStatusLabel, STATUS_GLYPHS } from "../src/services/status-glyphs.js";

/**
 * Claude Code modules cannot import from `src/`, and `opencode/tui.tsx` draws
 * before its dynamic import of `dist/` finishes. Both keep their own copy of
 * the footer labels. This test fails when a copy drifts from the shared table.
 * The Claude Code module's own tests run outside `ci:local`, so this is the
 * check that does run there.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("footer glyph parity", () => {
  it("keeps the Claude Code twin equal to the shared table", async () => {
    const twin = await import("../hooks/omms-status-glyphs.js");
    expect(twin.STATUS_GLYPHS).toEqual(STATUS_GLYPHS);
    for (const state of [...Object.keys(STATUS_GLYPHS), "web app off", "not installed"]) {
      expect(twin.ommsStatusLabel(state)).toBe(ommsStatusLabel(state as never));
    }
  });

  it("keeps the OpenCode entry's start and failure labels equal to the shared ones", () => {
    const entry = read("../opencode/tui.tsx");
    expect(entry).toContain(`createSignal("${ommsStatusLabel("warming")}")`);
    expect(entry).toContain(`setText("${ommsStatusLabel("error")}")`);
  });
});
