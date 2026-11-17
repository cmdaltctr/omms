import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import { settingsCatalogueText } from "../src/lib/i18n/settings-catalogue.ts";

const CJK = /[一-鿿]/;
const ARABIC = /[؀-ۿ]/;
const FILES = [
  "MemoryBasicsSection.tsx",
  "MemoryCleanupSection.tsx",
  "ExternalApiSection.tsx",
  "EmbeddingSection.tsx",
  "CaptureControls.tsx",
  "DiagnosticsSection.tsx",
  "WebAppSection.tsx",
  "KeysAccessSection.tsx",
  "ProfilesSection.tsx",
];
/** Texts that are the same in every language. */
const SAME = new Set(["OpenRouter"]);

/** Every plain string the cards pass to `t(...)` or `s(...)`. Template strings are skipped. */
function texts(file: string): string[] {
  const source = readFileSync(
    new URL(`../src/lib/components/settings/${file}`, import.meta.url),
    "utf8"
  );
  return [...source.matchAll(/\b[ts]\(\s*"((?:[^"\\]|\\.)*)"/g)].map((match) =>
    match[1]!.replace(/\\"/g, '"')
  );
}

it("has Chinese and Arabic text for every message the settings cards show", () => {
  const missing: string[] = [];
  for (const file of FILES) {
    for (const message of new Set(texts(file))) {
      if (SAME.has(message)) continue;
      const catalogue = settingsCatalogueText[message];
      const zh = catalogue?.[0] ?? translateSettings(message, "zh");
      const ar = catalogue?.[1] ?? translateSettings(message, "ar");
      if (!CJK.test(zh) || !ARABIC.test(ar)) missing.push(`${file}: ${message}`);
    }
  }
  expect(missing).toEqual([]);
});

it("keeps the {count} and {days} placeholders in every translation", () => {
  const broken: string[] = [];
  for (const [message, [zh, ar]] of Object.entries(settingsCatalogueText)) {
    for (const name of message.match(/\{[a-z]+\}/g) ?? []) {
      if (!zh.includes(name) || !ar.includes(name)) broken.push(`${message} (${name})`);
    }
  }
  expect(broken).toEqual([]);
});
