import { afterAll, afterEach, expect, it, mock, spyOn } from "bun:test";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bun's named builtin imports do not observe spies on the default export.
// Route the named import through that export before loading the registry store.
mock.module("node:fs", () => ({
  ...fs,
  default: fs,
  writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => fs.writeFileSync(...args),
  readFileSync: (...args: Parameters<typeof fs.readFileSync>) => fs.readFileSync(...args),
}));
const { createStoredSpace, spaceFiles } = await import("../src/services/spaces/registry-store.js");
const { listSpaces, readRegistryFile } = await import("../src/services/spaces/registry.js");
afterAll(() => mock.module("node:fs", () => ({ ...fs, default: fs })));

const dirs: string[] = [];
afterEach(() => {
  mock.restore();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// On Windows a lock file that one writer deleted while another still had it
// open stays "delete pending". Creating it again fails with EPERM, not EEXIST.
it.each(["EPERM", "EACCES", "EBUSY"])(
  "waits and retries when creating the lock fails with Windows %s",
  async (code: string) => {
    const dir = mkdtempSync(join(tmpdir(), "registry-lock-"));
    dirs.push(dir);
    const files = spaceFiles(dir);
    const real = fs.writeFileSync;
    let refused = 0;
    spyOn(fs, "writeFileSync").mockImplementation(((...args: Parameters<typeof real>) => {
      if (args[0] === files.lockPath && refused < 2) {
        refused++;
        throw Object.assign(new Error(code), { code });
      }
      return real(...args);
    }) as typeof real);
    await createStoredSpace(files, "Lab");
    expect(refused).toBe(2);
    const names = listSpaces(readRegistryFile(files.registryPath).registry).map((s) => s.name);
    expect(names).toContain("Lab");
  }
);

it("leaves a fresh lock that replaced the stale one it read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "registry-lock-"));
  dirs.push(dir);
  const files = spaceFiles(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(files.lockPath, JSON.stringify({ pid: 999_999, at: Date.now() - 60_000 }));
  const fresh = JSON.stringify({ pid: process.pid, at: Date.now() });
  const real = fs.readFileSync;
  let raced = false;
  // Another writer reclaims the stale lock and makes its own just after this
  // writer reads the stale one.
  spyOn(fs, "readFileSync").mockImplementation(((...args: Parameters<typeof real>) => {
    const text = real(...args);
    if (args[0] === files.lockPath && !raced) {
      raced = true;
      fs.unlinkSync(files.lockPath);
      fs.writeFileSync(files.lockPath, fresh);
    }
    return text;
  }) as typeof real);
  await expect(createStoredSpace(files, "Lab")).rejects.toThrow("changing the space list");
  expect(raced).toBe(true);
  expect(real(files.lockPath, "utf-8")).toBe(fresh);
}, 15_000);

it("still fails at once on an error that is not a busy file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "registry-lock-"));
  dirs.push(dir);
  const files = spaceFiles(dir);
  const real = fs.writeFileSync;
  spyOn(fs, "writeFileSync").mockImplementation(((...args: Parameters<typeof real>) => {
    if (args[0] === files.lockPath) throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    return real(...args);
  }) as typeof real);
  await expect(createStoredSpace(files, "Lab")).rejects.toThrow("ENOSPC");
});
