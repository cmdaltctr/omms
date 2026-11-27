import { expect, it } from "bun:test";
import { memorisationSizeRange } from "../../src/core/memorisation.ts";
import { MAIN_NAV, mainNavEntries } from "../src/lib/components/explorer/sidebar-main-nav.tsx";
import {
  DEFAULT_PRESETS,
  SIZE_RANGE,
  checkPresets,
  memorisationTitle,
  parseCap,
  presetSizeIn,
  presetsFrom,
  selectedPreset,
  withHosts,
} from "../src/lib/memorisation-model.ts";
import { isAppPath, pathForView, resolveAppPath, ROUTES, viewFromPath } from "../src/lib/routes.ts";
import { translations } from "../src/lib/i18n/translations.ts";

it("opens /memorisation directly and on reload, with or without a trailing slash", () => {
  expect(ROUTES.memorisation).toBe("/memorisation");
  for (const path of ["/memorisation", "/memorisation/"]) {
    expect(viewFromPath(path)).toBe("memorisation");
    expect(isAppPath(path)).toBe(true);
    // A reload resolves the path again and must keep it, not fall back to project memories.
    expect(resolveAppPath(path)).toBe("/memorisation");
  }
  expect(pathForView("memorisation")).toBe("/memorisation");
  // Neighbours keep their own pages.
  expect(viewFromPath("/memory")).toBe("memory");
  expect(viewFromPath("/memorisationx")).toBe("project");
  expect(resolveAppPath("/memorisation/other")).toBe("/project-memories");
});

it("lists Memorisation directly after User profile in the sidebar", () => {
  const views = MAIN_NAV.map((entry) => entry.view);
  expect(views.indexOf("memorisation")).toBe(views.indexOf("profile") + 1);

  const noop = () => {};
  const entries = mainNavEntries({
    currentView: "memorisation",
    labels: {
      chat: "Chat",
      project: "Project",
      memorisation: "Memorisation",
      profile: "Profile",
      skills: "Skills",
    },
    collapsed: false,
    navClass: () => "",
    onNavigate: noop,
    profileTree: {
      sections: [],
      open: false,
      onToggle: noop,
      hideWhenCollapsed: "",
      onSectionClick: noop,
    },
    skillsTree: {
      sections: [],
      open: false,
      onToggle: noop,
      hideWhenCollapsed: "",
      onSectionClick: noop,
    },
  });
  const link = entries.find((entry) => entry.props.href === "/memorisation")!;
  expect(link.props).toMatchObject({ label: "Memorisation", active: true });
  expect(entries.indexOf(link)).toBe(
    entries.findIndex((entry) => entry.props.link?.props.href === "/user-profile") + 1
  );
});

it("titles the page in every language", () => {
  expect(translations.en["nav-memorisation"]).toBe("Memorisation");
  for (const language of ["zh", "ar"] as const) {
    const title = translations[language]["nav-memorisation"];
    expect(title).toBeTruthy();
    expect(title).not.toBe("Memorisation");
  }
});

it("keeps the size ranges in step with the core", () => {
  expect(SIZE_RANGE.characters).toEqual(memorisationSizeRange("characters"));
  expect(SIZE_RANGE.tokens).toEqual(memorisationSizeRange("tokens"));
});

it("accepts only a whole number inside the range of the unit", () => {
  expect(parseCap("100", "characters")).toBe(100);
  expect(parseCap(" 20000 ", "characters")).toBe(20000);
  expect(parseCap("99", "characters")).toBeNull();
  expect(parseCap("20001", "characters")).toBeNull();
  expect(parseCap("25", "tokens")).toBe(25);
  expect(parseCap("5001", "tokens")).toBeNull();
  for (const bad of ["", "abc", "1.5", "-200", "2e3", "1,000"]) {
    expect(parseCap(bad, "characters")).toBeNull();
  }
});

it("titles a row with the Topic of a snapshot, else the first line", () => {
  expect(memorisationTitle("Topic: release\nDone: tagged")).toBe("release");
  expect(memorisationTitle("Done: tagged\nNext: publish")).toBe("Done: tagged");
  expect(memorisationTitle("\n  use port 4747\nmore")).toBe("use port 4747");
});

it("strips Markdown from the title", () => {
  expect(memorisationTitle("## OMRS harness **Docker** image")).toBe("OMRS harness Docker image");
  expect(memorisationTitle("# Plan")).toBe("Plan");
  expect(memorisationTitle("Use `bun run check` first")).toBe("Use bun run check first");
  expect(memorisationTitle("See [the docs](https://example.com/a_b) page")).toBe(
    "See the docs page"
  );
  expect(memorisationTitle("_slow_ and *fast*")).toBe("slow and fast");
  expect(memorisationTitle("- tagged the release")).toBe("tagged the release");
  expect(memorisationTitle("* tagged the release")).toBe("tagged the release");
  expect(memorisationTitle("1. tagged the release")).toBe("tagged the release");
  // Underscores inside a word stay.
  expect(memorisationTitle("set snake_case_name now")).toBe("set snake_case_name now");
});

it("titles a legacy Topic line before any Markdown, and a new snapshot by its first line", () => {
  expect(memorisationTitle("## Done\nTopic: **release**\n- tagged")).toBe("release");
  expect(memorisationTitle("omms release\n\n## Done\n- tagged\n- pushed\n\n## Next\npublish")).toBe(
    "omms release"
  );
  expect(memorisationTitle("## Next\npublish")).toBe("Next");
});

it("fills the host and kind of a recall match from the list", () => {
  const list = [{ id: "ms-aaaaaa", content: "x", host: "pi", kind: "snapshot" }];
  const [match, other] = withHosts(
    [
      { id: "ms-aaaaaa", content: "x", confidence: 90 },
      { id: "ms-bbbbbb", content: "y", confidence: 40 },
    ],
    list
  );
  expect(match).toMatchObject({ host: "pi", kind: "snapshot", confidence: 90 });
  expect(other!.host).toBeUndefined();
});

it("has every Memorisation text in Chinese and Arabic, in British English", () => {
  const keys = Object.keys(translations.en).filter(
    (key) => key.startsWith("memorisation-") || key === "nav-memorisation"
  );
  expect(keys.length).toBeGreaterThan(40);
  for (const language of ["zh", "ar"] as const) {
    const texts = translations[language] as Record<string, string>;
    expect(keys.filter((key) => !texts[key])).toEqual([]);
  }
  const english = translations.en as Record<string, string>;
  for (const key of keys) {
    expect(english[key]).not.toMatch(/memoriz|\bcolor\b|\bcenter\b/i);
    // Every placeholder in English appears in the other languages.
    for (const language of ["zh", "ar"] as const) {
      const placeholders = english[key]!.match(/\{\w+\}/g) ?? [];
      for (const placeholder of placeholders) {
        expect((translations[language] as Record<string, string>)[key]).toContain(placeholder);
      }
    }
  }
});

it("converts a preset to tokens with the core rule", () => {
  expect(presetSizeIn(800, "characters")).toBe(800);
  expect(presetSizeIn(800, "tokens")).toBe(200);
  expect(presetSizeIn(5000, "tokens")).toBe(1250);
  expect(presetSizeIn(101, "tokens")).toBe(26);
});

it("reads the presets from the settings, with the defaults when a key is missing", () => {
  expect(DEFAULT_PRESETS).toEqual({ short: 800, medium: 2000, long: 5000 });
  expect(presetsFrom(() => undefined)).toEqual(DEFAULT_PRESETS);
  expect(presetsFrom((key) => (key === "memorisationShortSize" ? 1000 : undefined))).toEqual({
    short: 1000,
    medium: 2000,
    long: 5000,
  });
  expect(presetsFrom(() => "x")).toEqual(DEFAULT_PRESETS);
});

it("selects the preset that matches the size in the unit, else Custom", () => {
  expect(selectedPreset("800", "characters", DEFAULT_PRESETS)).toBe("short");
  expect(selectedPreset("2000", "characters", DEFAULT_PRESETS)).toBe("medium");
  expect(selectedPreset("500", "tokens", DEFAULT_PRESETS)).toBe("medium");
  expect(selectedPreset("1250", "tokens", DEFAULT_PRESETS)).toBe("long");
  expect(selectedPreset("3000", "characters", DEFAULT_PRESETS)).toBe("custom");
  expect(selectedPreset("", "characters", DEFAULT_PRESETS)).toBe("custom");
  expect(selectedPreset("12abc", "characters", DEFAULT_PRESETS)).toBe("custom");
  const edited = { ...DEFAULT_PRESETS, short: 1000 };
  expect(selectedPreset("1000", "characters", edited)).toBe("short");
  expect(selectedPreset("250", "tokens", edited)).toBe("short");
  expect(selectedPreset("800", "characters", edited)).toBe("custom");
});

it("checks the edited presets and names the broken rule", () => {
  const ok = { short: "1000", medium: "2000", long: "5000" };
  expect(checkPresets(ok)).toEqual({ presets: { short: 1000, medium: 2000, long: 5000 } });
  expect(checkPresets({ ...ok, short: "99" })).toEqual({
    problem: { rule: "range", preset: "short" },
  });
  expect(checkPresets({ ...ok, long: "20001" })).toEqual({
    problem: { rule: "range", preset: "long" },
  });
  expect(checkPresets({ ...ok, medium: "1.5" })).toEqual({
    problem: { rule: "range", preset: "medium" },
  });
  expect(checkPresets({ ...ok, short: "2500" })).toEqual({
    problem: { rule: "order", lower: "short", higher: "medium" },
  });
  expect(checkPresets({ ...ok, medium: "5000" })).toEqual({
    problem: { rule: "order", lower: "medium", higher: "long" },
  });
  // 101 and 104 characters are both about 26 tokens.
  expect(checkPresets({ ...ok, short: "101", medium: "104" })).toEqual({
    problem: { rule: "token", lower: "short", higher: "medium", tokens: 26 },
  });
  expect(checkPresets({ ...ok, medium: "2001", long: "2004" })).toEqual({
    problem: { rule: "token", lower: "medium", higher: "long", tokens: 501 },
  });
  expect(checkPresets({ ...ok, short: "104", medium: "105" })).toEqual({
    presets: { short: 104, medium: 105, long: 5000 },
  });
});
