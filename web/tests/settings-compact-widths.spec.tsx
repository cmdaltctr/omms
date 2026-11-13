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

it("gives the External API card five compact wrappers", () => {
  // Preset and Provider; API URL, Model, and the API key fieldset join them.
  expect(compactWrappers(externalSource)).toHaveLength(5);
  expect(externalSource).toMatch(/\{s\("Preset"\)\}\s*<div className=\{[^}]*compactField/);
});

it("wraps the API URL and Model inputs", () => {
  expect(externalSource).toMatch(/\{s\("API URL"\)\}\s*<div className=\{[^}]*compactField/);
  expect(externalSource).toMatch(/\{s\("Model"\)\}\s*<div className=\{[^}]*compactField/);
});

it("caps the API key fieldset at the compact width", () => {
  // The bordered fieldset itself carries the compact width, so the box hugs
  // its contents instead of spanning the card around a narrow column.
  const open = externalSource.search(/<fieldset[^>]*className=\{[^}]*compactField/);
  expect(open).toBeGreaterThanOrEqual(0);
  const block = externalSource.slice(open, externalSource.indexOf("</fieldset>", open));
  for (const part of [
    '["env", "Environment variable"]',
    '["file", "Key file"]',
    '["paste", "Save key to a private file"]',
    'aria-label={s("Variable name")}',
    'aria-label={s("Key file path")}',
    'aria-label={s("Key file name")}',
    'aria-label={s("API key")}',
    's("Save key source")',
  ]) {
    expect(block).toContain(part);
  }
  // The fieldset is the only compact element inside itself: the inner wrapper
  // carries no width of its own.
  expect(block.match(/compactField/g)).toHaveLength(1);
});

it("wraps each Model choice dropdown", () => {
  expect(compactWrappers(modelsSource)).toHaveLength(1);
  expect(modelsSource).toMatch(
    /className=\{[^}]*compactField[^>]*>\s*<Select\s+id=\{`\$\{host\}-model`\}/
  );
});

it("keeps the model picker and the typed provider/model input full width", () => {
  const fullWidth = 'className="w-full rounded-lg border border-border bg-background p-2 text-sm"';
  // Three controls keep the class: the Model choice, the model picker, and the
  // typed input; only the Model choice sits inside the compact wrapper.
  expect(modelsSource.split(fullWidth).length - 1).toBe(3);
  expect(modelsSource).not.toMatch(/className=\{[^}]*compactField[^>]*>\s*<Select\s+className=/);
  expect(modelsSource).not.toMatch(/className=\{[^}]*compactField[^>]*>\s*<input/);
});
