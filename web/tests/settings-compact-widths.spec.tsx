import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The compact width is a wrapper div around the control in the component source,
// so these specs read the source text and count wrappers instead of rendering.
const externalSource = readFileSync(
  join(import.meta.dir, "../src/lib/components/settings/ExternalApiSection.tsx"),
  "utf8"
);
const modelsSource = readFileSync(
  join(import.meta.dir, "../src/lib/components/settings/ModelsSection.tsx"),
  "utf8"
);

const compactWrappers = (source: string) => source.match(/className=\{[^}]*compactField/g) ?? [];

it("lays the External API card out with the shared setting rows and key control", () => {
  // The rows set their own width; the card no longer wraps each control in compactField.
  expect(compactWrappers(externalSource)).toHaveLength(0);
  for (const setting of ["memoryProvider", "memoryApiUrl", "memoryModel", "memoryApiKey"]) {
    expect(externalSource).toContain(`<SettingRow setting="${setting}"`);
  }
  expect(externalSource).toContain("<KeySourceField");
});

it("lays each Model choice out as a setting row", () => {
  expect(compactWrappers(modelsSource)).toHaveLength(0);
  expect(modelsSource).toMatch(
    /<SettingRow setting=\{`\$\{host\}Model`\} controlId=\{`\$\{host\}-model`\}>\s*<Select\s+id=\{`\$\{host\}-model`\}/
  );
});

it("keeps the model picker and the typed provider/model input full width", () => {
  const fullWidth = 'className="w-full rounded-lg border border-border bg-background p-2 text-sm"';
  // Two controls keep the class: the model picker and the typed input. The Model choice sits
  // in a setting row, which sets its own width.
  expect(modelsSource.split(fullWidth).length - 1).toBe(2);
  expect(modelsSource).not.toMatch(/className=\{[^}]*compactField[^>]*>\s*<Select\s+className=/);
  expect(modelsSource).not.toMatch(/className=\{[^}]*compactField[^>]*>\s*<input/);
});
