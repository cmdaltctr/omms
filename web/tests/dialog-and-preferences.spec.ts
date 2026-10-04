import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { translations } from "../src/lib/i18n/translations.ts";
import { readPreference } from "../src/lib/preferences.ts";

const dialogSource = readFileSync(
  join(import.meta.dir, "../src/lib/components/ui/dialog.tsx"),
  "utf8"
);

it("uses a translated accessible dialog-close label and logical end placement", () => {
  expect(translations.en["dialog-close"]).toBe("Close");
  expect(translations.zh["dialog-close"]).toBe("关闭");
  expect(translations.ar["dialog-close"]).toBe("إغلاق");
  expect(dialogSource).toContain('import { useI18n } from "$lib/i18n"');
  expect(dialogSource).toMatch(/const\s*\{\s*t\s*\}\s*=\s*useI18n\(\)/);
  expect(dialogSource).toContain('t("dialog-close")');
  expect(dialogSource).toMatch(/absolute\s+top-4\s+end-4/);
  expect(dialogSource).not.toMatch(/\bright-4\b/);
});

it("keeps current preferences ahead of legacy theme and language preferences", () => {
  const store = new Map<string, string>([
    ["omms-theme", "light"],
    ["opencode-mem-theme", "dark"],
    ["omms-lang", "zh"],
    ["opencode-mem-lang", "ar"],
  ]);
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  } as Storage;

  expect(readPreference("omms-theme", "opencode-mem-theme")).toBe("light");
  expect(readPreference("omms-lang", "opencode-mem-lang")).toBe("zh");
});

it("adopts a legacy preference only when its current key is absent", () => {
  const store = new Map<string, string>([["opencode-mem-lang", "ar"]]);
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  } as Storage;

  expect(readPreference("omms-lang", "opencode-mem-lang")).toBe("ar");
  expect(store.get("omms-lang")).toBe("ar");
});
