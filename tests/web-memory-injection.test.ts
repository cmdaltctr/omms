import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_INJECTION_DRAFT,
  OPENING_QUERY_MAX,
  canSaveInjection,
  injectionDraftFromSettings,
  injectionSaveEdits,
  parseRestoreLimit,
} from "../web/src/lib/injection-controls.ts";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
const DEFAULT_QUERY = "project architecture, setup, conventions and key decisions";

describe("Memory injection draft", () => {
  it("starts from the defaults when the file sets nothing", () => {
    expect(DEFAULT_INJECTION_DRAFT).toEqual({
      opening: false,
      query: DEFAULT_QUERY,
      subagent: true,
      restore: true,
      limit: "10",
    });
    expect(injectionDraftFromSettings(undefined)).toEqual(DEFAULT_INJECTION_DRAFT);
    expect(injectionDraftFromSettings({})).toEqual(DEFAULT_INJECTION_DRAFT);
  });

  it("reads the global values of the snapshot", () => {
    const draft = injectionDraftFromSettings({
      openingContext: { globalValue: true, default: false },
      openingContextQuery: { globalValue: "release notes", default: DEFAULT_QUERY },
      subagentMemory: { globalValue: false, default: true },
      "compaction.enabled": { globalValue: false, default: true },
      "compaction.memoryLimit": { globalValue: 25, default: 10 },
    });
    expect(draft).toEqual({
      opening: true,
      query: "release notes",
      subagent: false,
      restore: false,
      limit: "25",
    });
  });

  it("accepts only positive whole numbers as the restore limit", () => {
    expect(parseRestoreLimit("10")).toBe(10);
    expect(parseRestoreLimit(" 3 ")).toBe(3);
    for (const bad of ["0", "-3", "2.5", "abc", "", "1e3"]) {
      expect(parseRestoreLimit(bad)).toBeUndefined();
    }
  });
});

describe("Memory injection save and reset", () => {
  const loaded = DEFAULT_INJECTION_DRAFT;

  it("sends nothing while the draft equals what was loaded", () => {
    expect(injectionSaveEdits(loaded, loaded)).toEqual({});
    expect(canSaveInjection(loaded, loaded)).toBe(false);
  });

  it("sends only the changed keys, with the trimmed query", () => {
    const draft = { ...loaded, opening: true, query: "  release notes  ", restore: false };
    expect(injectionSaveEdits(draft, loaded)).toEqual({
      openingContext: true,
      openingContextQuery: "release notes",
      "compaction.enabled": false,
    });
    expect(canSaveInjection(draft, loaded)).toBe(true);
  });

  it("sends the limit as a number", () => {
    expect(injectionSaveEdits({ ...loaded, limit: "25" }, loaded)).toEqual({
      "compaction.memoryLimit": 25,
    });
  });

  it("blocks Save for a limit that is not a positive whole number", () => {
    for (const limit of ["0", "-3", "2.5", "abc", ""]) {
      const draft = { ...loaded, limit, opening: true };
      expect(canSaveInjection(draft, loaded)).toBe(false);
      expect(injectionSaveEdits(draft, loaded)).toEqual({});
    }
  });

  it("blocks Save for a query over 500 characters, and allows exactly 500", () => {
    expect(OPENING_QUERY_MAX).toBe(500);
    expect(canSaveInjection({ ...loaded, query: "a".repeat(501) }, loaded)).toBe(false);
    expect(canSaveInjection({ ...loaded, query: "a".repeat(500) }, loaded)).toBe(true);
  });

  it("removes the query and the limit when the draft returns to the defaults", () => {
    const custom = {
      opening: true,
      query: "release notes",
      subagent: false,
      restore: false,
      limit: "25",
    };
    // Every key returns to its default as null, so Save removes it from the file.
    expect(injectionSaveEdits(DEFAULT_INJECTION_DRAFT, custom)).toEqual({
      openingContext: null,
      openingContextQuery: null,
      subagentMemory: null,
      "compaction.enabled": null,
      "compaction.memoryLimit": null,
    });
  });
});

describe("Memory injection placement", () => {
  it("draws the section after the host cards and after the Import all hosts row", () => {
    const source = read("web/src/lib/components/memory/MemoryOverview.tsx");
    const cards = source.indexOf("MEMORY_VIEWS.map");
    const importRow = source.indexOf('id="memory-import-all"');
    const section = source.indexOf("<MemoryInjectionSection");
    expect(cards).toBeGreaterThan(-1);
    expect(importRow).toBeGreaterThan(cards);
    expect(section).toBeGreaterThan(importRow);
    expect(source.indexOf("<MemoryInjectionSection", section + 1)).toBe(-1);
  });

  it("anchors the section as memory-injection", () => {
    const source = read("web/src/lib/components/memory/MemoryInjectionSection.tsx");
    expect(source).toContain('id="memory-injection"');
    expect(source).toContain('s("Memory injection")');
  });

  it("keeps the section out of the Settings page", () => {
    expect(read("web/src/lib/components/settings/SettingsView.tsx")).not.toContain(
      "MemoryInjection"
    );
    expect(read("web/src/lib/settings-sections.ts")).not.toContain("injection");
  });

  it("lets a link to the section scroll to it", () => {
    expect(read("web/src/lib/settings-navigation.ts")).toContain("memory-injection");
  });
});
