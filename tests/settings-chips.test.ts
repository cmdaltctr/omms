import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { SETTINGS_SECTIONS } from "../web/src/lib/settings-sections.ts";

const view = readFileSync(
  join(import.meta.dir, "../web/src/lib/components/settings/SettingsView.tsx"),
  "utf8"
);
const button = readFileSync(
  join(import.meta.dir, "../web/src/lib/components/ui/button.tsx"),
  "utf8"
);

describe("the Settings page section chips", () => {
  it("no longer mounts the floating contents", () => {
    expect(view).not.toContain("PageToc");
  });

  it("renders one pressed-state chip per section from SETTINGS_SECTIONS, and a chip does not reveal", () => {
    expect(view).toContain('variant="chip"');
    expect(view).toContain("SETTINGS_SECTIONS.map");
    expect(view).toContain("aria-pressed={selected === id}");
    expect(view).toContain("{ reveal: false }");
    expect(view).toContain('role="group"');
  });

  it("keeps every card mounted and hides the ones that are not selected", () => {
    expect(view).toContain("hidden={id !== selected}");
  });

  it("the chip variant carries the OMRS classes", () => {
    expect(button).toContain(
      "border-border bg-transparent text-foreground hover:bg-interactive-hover active:bg-interactive-active aria-pressed:bg-selection"
    );
  });

  it("lists every settings section, each with its settings-section id, and keeps the ids on the page", () => {
    expect(SETTINGS_SECTIONS.length).toBeGreaterThan(0);
    for (const section of SETTINGS_SECTIONS) {
      expect(section.id).toMatch(/^settings-section-[a-z-]+$/);
    }
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(
      SETTINGS_SECTIONS.length
    );
    expect(view).toContain("id={id}");
    expect(view).toContain("scroll-mt-20 md:scroll-mt-4");
  });
});
