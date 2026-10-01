import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_SEARCH_FIRST, memoryToolDescription } from "../src/core/memory-tool-text.js";

it("asks the agent to search memory before debugging or investigating", () => {
  expect(MEMORY_SEARCH_FIRST).toContain("before you debug or investigate");
  const text = memoryToolDescription("English");
  expect(text).toContain(MEMORY_SEARCH_FIRST);
  expect(text).toContain("MATCH USER LANGUAGE: English");
});

it("gives Pi and OpenCode the same description from one function", () => {
  for (const file of ["src/index.ts", "src/adapters/pi/extension.ts"]) {
    const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
    expect(source).toContain("memoryToolDescription(");
    expect(source).not.toContain("Manage and query project memory");
  }
});
