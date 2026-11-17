import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { problemViews } from "../src/lib/config-problem-view.ts";
import { SETTINGS_SECTIONS } from "../src/lib/settings-sections.ts";

it("turns a syntax error into a banner line with file, line and column", () => {
  expect(
    problemViews([
      {
        kind: "parse",
        file: "~/.config/omms/omms.jsonc",
        line: 7,
        column: 3,
        message: "A comma is missing between two settings.",
      },
    ])
  ).toEqual([
    // The server's English sentence stays for hosts and logs; the page builds its own.
    { file: "~/.config/omms/omms.jsonc", line: 7, column: 3 },
  ]);
});

it("turns a rejected value into a key and the values it accepts, with no value shown", () => {
  const [view] = problemViews([
    {
      kind: "value",
      file: "~/.config/omms/omms.jsonc",
      key: "autoCleanupRetentionDays",
      accepted: "a whole number of 1 or more",
      message: "x",
    },
  ]);
  expect(view).toEqual({
    file: "~/.config/omms/omms.jsonc",
    key: "autoCleanupRetentionDays",
    accepted: "a whole number of 1 or more",
  });
  expect(problemViews(undefined)).toEqual([]);
});

it("puts Memory basics and Memory cleanup first, with the card ids the catalogue links to", () => {
  expect(SETTINGS_SECTIONS.slice(0, 2).map((section) => section.id)).toEqual([
    "settings-section-memory-basics",
    "settings-section-memory-cleanup",
  ]);
});

it("mounts the search box and the problem banner above the cards, and gives the banner the read-only flag", () => {
  const source = readFileSync(
    new URL("../src/lib/components/settings/SettingsView.tsx", import.meta.url),
    "utf8"
  );
  expect(source).toContain("<SettingsSearch />");
  expect(source).toContain("problems={problemViews(snapshot?.problems)}");
  expect(source).toContain("readOnly={snapshot?.readOnly === true}");
  expect(source.indexOf("<SettingsSearch />")).toBeLessThan(
    source.indexOf("SETTINGS_SECTIONS.map")
  );
});

it("turns off Save and Apply in every card that writes the config while it cannot be read", () => {
  const cards = [
    "settings/CaptureControls",
    "settings/CaptureLanguageSection",
    "settings/ClaudeFolderSection",
    "settings/EmbeddingSection",
    "settings/ExternalApiSection",
    "settings/KeysAccessSection",
    "settings/MemoryBasicsSection",
    "settings/MemoryCleanupSection",
    "settings/ModelsSection",
    "settings/OpenRouterRouting",
    "settings/ProfilesSection",
    "settings/SkillLearningSection",
    "settings/WebAppSection",
    "memory/AutoCleanupSettings",
    "memory/DirectoryMapsSection",
    "memory/HostSettings",
    "memory/KeywordModeSection",
    "memory/MemoryInjectionSection",
    "memory/MemorySection",
    "memory/RerankerSection",
  ];
  const missing = cards.filter((card) => {
    const source = readFileSync(
      new URL(`../src/lib/components/${card}.tsx`, import.meta.url),
      "utf8"
    );
    // The flag must reach a disabled prop, and the card must say why.
    const flagged = /disabled=\{[^}]*readOnly|busy=\{[^}]*readOnly/.test(source);
    return !flagged || !/Saving is turned off|ReadOnlyNote/.test(source);
  });
  expect(missing).toEqual([]);
});
