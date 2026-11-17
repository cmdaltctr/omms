import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  entryTexts,
  PAGE_LABELS,
  PLAIN_TEXT,
  SETTINGS_CATALOGUE,
  settingTarget,
} from "../src/lib/settings-catalogue.ts";
import { settingsCatalogueText } from "../src/lib/i18n/settings-catalogue.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

/** The list of keys the writer accepts: its three key sets, read from the source file. */
function writerKeys(): string[] {
  const source = read("src/services/settings-editable-keys.ts");
  const keys: string[] = [];
  for (const name of [
    "export const PAGE_KEYS: ReadonlySet<string>",
    "export const EMBEDDING_KEYS",
    "export const PASSWORD_KEYS",
  ]) {
    const start = source.search(new RegExp(`${name} = new Set(<string>)?\\(\\[`));
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start, source.indexOf("])", start));
    keys.push(...[...body.matchAll(/"([A-Za-z.]+)"/g)].map((match) => match[1]!));
  }
  return keys;
}

/** The keys that the settings server routes add (group 4 of friendly-settings). */
const NEW_WRITABLE_KEYS = [
  "autoCaptureEnabled",
  "chatMessage.enabled",
  "visibleRecall",
  "injectProfile",
  "memory.defaultScope",
  "autoDeleteOldMemories",
  "autoCleanupRetentionDays",
];

const byKey = new Map(SETTINGS_CATALOGUE.map((entry) => [entry.key, entry]));

it("has an entry for every key the settings writer accepts", () => {
  const missing = writerKeys().filter((key) => !byKey.has(key));
  expect(missing).toEqual([]);
});

it("has an entry for each key that the settings server is about to accept", () => {
  expect(NEW_WRITABLE_KEYS.filter((key) => !byKey.has(key))).toEqual([]);
});

it("has no entry for a key the page cannot save", () => {
  const known = new Set([...writerKeys(), ...NEW_WRITABLE_KEYS]);
  expect(SETTINGS_CATALOGUE.filter((entry) => !known.has(entry.key)).map((e) => e.key)).toEqual([]);
  // The retired key never gets a row: the page never writes it.
  expect(byKey.has("autoCleanupEnabled")).toBe(false);
});

it("gives each entry a name, description, default, what it affects, page and anchor", () => {
  expect(new Set(SETTINGS_CATALOGUE.map((entry) => entry.key)).size).toBe(
    SETTINGS_CATALOGUE.length
  );
  for (const entry of SETTINGS_CATALOGUE) {
    for (const field of ["name", "description", "default", "affects", "anchor"] as const) {
      expect({ key: entry.key, field, value: entry[field].trim() !== "" }).toEqual({
        key: entry.key,
        field,
        value: true,
      });
    }
    expect(["settings", "memory", "memorisation", "skills"]).toContain(entry.page);
    expect(entry.anchor).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(settingTarget(entry).hash).toBe(`#${entry.anchor}`);
  }
});

it("keeps raw terms out of the plain names and descriptions", () => {
  for (const entry of SETTINGS_CATALOGUE) {
    expect(`${entry.name} ${entry.description}`).not.toMatch(/ceil\(|UTF-8|\bRRF\b|\bbytes\b/i);
  }
});

/** Product names that every language writes the same way. */
const SAME_IN_EVERY_LANGUAGE = new Set(["OpenAI Chat Completions"]);
const CJK = /[一-鿿]/;
const ARABIC = /[؀-ۿ]/;

it("has every text in English, Chinese and Arabic", () => {
  const texts = [
    ...SETTINGS_CATALOGUE.flatMap(entryTexts),
    ...Object.values(PAGE_LABELS),
    ...Object.values(PLAIN_TEXT),
  ];
  const missing: string[] = [];
  for (const text of new Set(texts)) {
    if (SAME_IN_EVERY_LANGUAGE.has(text)) continue;
    const pair = (settingsCatalogueText as Record<string, readonly [string, string]>)[text];
    if (!pair || !CJK.test(pair[0]) || !ARABIC.test(pair[1])) missing.push(text);
  }
  expect(missing).toEqual([]);
});

it("has every text that the shared pieces show in Chinese and Arabic", () => {
  const files = [
    "web/src/lib/components/settings/SettingRow.tsx",
    "web/src/lib/components/settings/KeySourceField.tsx",
    "web/src/lib/components/settings/SettingsConfirmDialog.tsx",
    "web/src/lib/components/settings/SettingsSearch.tsx",
    "web/src/lib/components/settings/ConfigProblemBanner.tsx",
  ];
  const missing: string[] = [];
  for (const file of files) {
    for (const match of read(file).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const text = match[1]!.replace(/\\"/g, '"');
      const pair = (settingsCatalogueText as Record<string, readonly [string, string]>)[text];
      if (!pair || !CJK.test(pair[0]) || !ARABIC.test(pair[1])) missing.push(`${file}: ${text}`);
    }
  }
  expect(missing).toEqual([]);
});

/**
 * An anchor that no element on its page carries yet. The `simpler-import` change adds the
 * automatic import switch to the Memory overview with this id; until then search opens the page.
 */
const ANCHORS_ADDED_ELSEWHERE: Record<string, string> = {
  autoBackfill: "memory-section-auto-import",
};

it("finds every catalogue anchor as an element id on its page", async () => {
  const { readdirSync } = await import("node:fs");
  const { SETTINGS_SECTIONS } = await import("../src/lib/settings-sections.ts");
  const sources = (folder: string) =>
    readdirSync(new URL(`web/src/lib/components/${folder}/`, root))
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => read(`web/src/lib/components/${folder}/${file}`))
      .join("\n");
  const pages: Record<string, string> = {
    memory: sources("memory"),
    skills: sources("skills"),
    memorisation: sources("memorisation"),
  };
  const sectionIds = new Set<string>(SETTINGS_SECTIONS.map((section) => section.id));
  const missing = SETTINGS_CATALOGUE.filter((entry) => {
    if (ANCHORS_ADDED_ELSEWHERE[entry.key] === entry.anchor) return false;
    if (entry.page === "settings") return !sectionIds.has(entry.anchor);
    return !pages[entry.page]!.includes(`id="${entry.anchor}"`);
  }).map((entry) => `${entry.key} -> ${entry.page}#${entry.anchor}`);
  expect(missing).toEqual([]);
  // The known exception still points where the other change puts the switch.
  expect(pages.memory).not.toContain(`id="${ANCHORS_ADDED_ELSEWHERE.autoBackfill}"`);
});
