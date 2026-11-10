import { expect, it } from "bun:test";
import { memorisationSizeRange } from "../../src/core/memorisation.ts";
import { MAIN_NAV, mainNavEntries } from "../src/lib/components/explorer/sidebar-main-nav.tsx";
import {
  SIZE_RANGE,
  memorisationTitle,
  parseCap,
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
