import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { SETTINGS_SECTIONS } from "../web/src/lib/settings-sections.ts";

const view = readFileSync(
  join(import.meta.dir, "../web/src/lib/components/settings/SettingsView.tsx"),
  "utf8"
);
const shell = readFileSync(join(import.meta.dir, "../web/src/lib/components/PageToc.tsx"), "utf8");

describe("the Settings page table of contents", () => {
  it("mounts the shared floating contents under its own storage key", () => {
    expect(view).toContain(
      '<PageToc storageKey="omms-settings-toc-open" sections={SETTINGS_SECTIONS} />'
    );
  });

  it("the shared shell floats, jumps and caps its height", () => {
    expect(shell).toContain("fixed top-16");
    expect(shell).toContain("flashAnchor(element)");
    expect(shell).toContain("max-h-[70vh]");
  });

  it("lists every settings section, each with its settings-section id", () => {
    expect(SETTINGS_SECTIONS.length).toBeGreaterThan(0);
    for (const section of SETTINGS_SECTIONS) {
      expect(section.id).toMatch(/^settings-section-[a-z-]+$/);
    }
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(
      SETTINGS_SECTIONS.length
    );
  });
});
