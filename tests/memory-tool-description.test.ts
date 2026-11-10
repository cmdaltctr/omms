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

it("tells the agent about memorise and recall", () => {
  const text = memoryToolDescription("English");
  expect(text).toContain("'memorise'");
  expect(text).toContain("'recall'");
  expect(text).toContain("ms-");
  expect(text).toContain("snapshot");
});

it("tells the agent to use recall, not search, for what was planned or memorised", () => {
  const text = memoryToolDescription("English");
  expect(text).toContain("what was planned or memorised");
  expect(text).toContain("use 'recall', not 'search'");
});

it("gives Pi and OpenCode the same description from one function", () => {
  for (const file of ["src/index.ts", "src/adapters/pi/extension.ts"]) {
    const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
    expect(source).toContain("memoryToolDescription(");
    expect(source).not.toContain("Manage and query project memory");
  }
});
