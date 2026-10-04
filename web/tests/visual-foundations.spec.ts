import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const webRoot = join(import.meta.dir, "..");
const readWebSource = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");

it("uses the approved warm palette, system UI font, and preserved markdown code role", () => {
  const css = readWebSource("src", "app.css");

  expect(css).toMatch(
    /:root\s*\{[\s\S]*?--background:\s*#fdfcfa;[\s\S]*?--foreground:\s*#393a34;[\s\S]*?--primary:\s*#b35017;/
  );
  expect(css).toMatch(
    /\.dark\s*\{[\s\S]*?--background:\s*#120f0e;[\s\S]*?--foreground:\s*#c9c5ba;[\s\S]*?--primary:\s*#da7c47;/
  );
  expect(css).toContain(
    '--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;'
  );
  expect(css).toMatch(/body\s*\{[\s\S]*?font-sans/);
  expect(css).toMatch(/\.markdown-content\s*\{[\s\S]*?line-height:\s*1\.6;/);
  expect(css).toMatch(/\.markdown-content code\s*\{[\s\S]*?font-family:\s*var\(--font-mono\);/);
});

it("gives shared buttons and inputs the approved dimensions and semantic states", () => {
  const button = readWebSource("src", "lib", "components", "ui", "button.tsx");
  const input = readWebSource("src", "lib", "components", "ui", "input.tsx");

  expect(button).toMatch(/default:\s*["'`]h-9\b/);
  expect(button).toMatch(/sm:\s*["'`]h-8\b/);
  expect(button).toMatch(/lg:\s*["'`]h-10\b/);
  expect(button).toMatch(/default:\s*["'`][^"'`]*bg-primary\/10[^"'`]*border-primary\//);
  expect(button).toMatch(/default:\s*["'`][^"'`]*text-primary/);
  expect(button).toMatch(/destructive:\s*["'`][^"'`]*text-destructive/);
  expect(button).toContain("disabled:pointer-events-none");
  expect(button).toContain("aria-invalid:border-destructive");
  expect(input).toMatch(/\bh-9\b/);
  expect(input).toContain("bg-card");
  expect(input).toContain("focus-visible:border-ring");
  expect(input).toContain("aria-invalid:border-destructive");
});

it("maps semantic theme aliases for readable states in both themes", () => {
  const css = readWebSource("src", "app.css");

  for (const theme of [":root", ".dark"]) {
    const block = new RegExp(
      `${theme.replace(".", "\\.")}\\s*\\{[\\s\\S]*?--selection:[\\s\\S]*?--ring:[\\s\\S]*?--status-warning-label:[\\s\\S]*?--status-success-label:[\\s\\S]*?--status-info-label:`
    );
    expect(css).toMatch(block);
  }
  expect(css).toContain("--color-selection: var(--selection);");
  expect(css).toContain("--color-ring: var(--ring);");
  expect(css).toContain("--color-status-warning: var(--status-warning-label);");
  expect(css).toContain("--color-status-success: var(--status-success-label);");
  expect(css).toContain("--color-status-info: var(--status-info-label);");
});

it("gives the shared Select the same field boundary, focus, and value contract", () => {
  const select = readWebSource("src", "lib", "components", "ui", "select.tsx");

  expect(select).toContain('role="combobox"');
  expect(select).toContain('role="listbox"');
  expect(select).toContain("flex h-9");
  expect(select).toContain("border-input bg-card");
  expect(select).toContain("focus-visible:border-ring");
  expect(select).toContain(
    "onChange({ target: { value: option.value }, currentTarget: { value: option.value } })"
  );
});
