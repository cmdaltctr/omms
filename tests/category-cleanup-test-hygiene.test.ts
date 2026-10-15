import { expect, it } from "bun:test";
import { join } from "node:path";

// These files open user-profiles.db. libsql keeps its file handles until garbage
// collection, so a bare rmSync fails with EBUSY on Windows (TDR-018, TDR-049).
const FILES = ["service", "api", "job", "verdicts"].map(
  (name) => `category-cleanup-${name}.test.ts`
);

it.each(FILES)("%s removes its temporary folder through the shared Turso cleanup", async (file) => {
  const source = await Bun.file(join(import.meta.dir, file)).text();
  expect(source).toContain("cleanupTursoTestDirectory(");
  expect(source).not.toContain("rmSync(");
});
