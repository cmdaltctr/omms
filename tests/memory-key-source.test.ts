import { afterEach, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeMemoryKeySource } from "../src/services/memory-key-source.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("removes a new key file when it cannot be made private, so a retry works", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omms-key-"));
  dirs.push(directory);
  const failing = (path: string) => {
    if (path.endsWith(".key")) throw new Error("PowerShell timed out");
  };
  await expect(
    storeMemoryKeySource(
      { source: "paste", name: "zai", value: "sk-secret" },
      { directory, restrict: failing }
    )
  ).rejects.toMatchObject({ status: 500, message: "The key file could not be made private" });
  expect(existsSync(join(directory, "zai.key"))).toBe(false);

  const stored = await storeMemoryKeySource(
    { source: "paste", name: "zai", value: "sk-secret" },
    { directory, restrict: () => {} }
  );
  expect(stored.reference).toBe(`file://${join(directory, "zai.key")}`);
});
