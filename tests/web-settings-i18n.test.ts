import { expect, it } from "bun:test";
import { translateSettings } from "../web/src/lib/i18n/settings.js";

it("translates Settings labels in English, Chinese, and Arabic", () => {
  expect(translateSettings("Start import", "en")).toBe("Start import");
  expect(translateSettings("Start import", "zh")).toBe("开始导入");
  expect(translateSettings("Start import", "ar")).toBe("بدء الاستيراد");
  expect(translateSettings("Manual model", "zh")).toBe("手动选择模型");
  expect(translateSettings("Manual model", "ar")).toBe("اختيار النموذج يدوياً");
});

it("has Chinese and Arabic text for every literal label in the Settings sections", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const folder = join(import.meta.dir, "../web/src/lib/components/settings");
  const missing: string[] = [];
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".tsx"))) {
    const source = readFileSync(join(folder, file), "utf8");
    for (const match of source.matchAll(/\bs\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
      const label = JSON.parse(`"${match[1]}"`) as string;
      if (translateSettings(label, "zh") === label || translateSettings(label, "ar") === label) {
        missing.push(`${file}: ${label}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
