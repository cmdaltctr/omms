import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// The automatic cleanup starts after a live learning pass and nowhere else. A history
// import, a backfill or a catch-up run can add hundreds of prompts at once, and each of
// those would start a run if it called the cleanup.

const root = join(import.meta.dir, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("who may start the automatic cleanup", () => {
  it("is called only from the three live learning paths", () => {
    const callers = sourceFiles(root)
      .filter((file) => /user-profile\/auto-cleanup\.js["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).split("\\").join("/"))
      .sort();
    expect(callers).toEqual([
      "adapters/opencode/profile-learning.ts",
      "adapters/pi/profile.ts",
      "importer/claude-profile-learning.ts",
    ]);
  });
});
