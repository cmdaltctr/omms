import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpaceError, listSpaces, readRegistryFile } from "../src/services/spaces/registry.js";
import {
  archiveStoredSpace,
  createStoredSpace,
  renameStoredSpace,
  spaceFiles,
  switchStoredSpace,
  unarchiveStoredSpace,
} from "../src/services/spaces/registry-store.js";

let dir: string;
let files: ReturnType<typeof spaceFiles>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omms-spaces-store-"));
  files = spaceFiles(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SpaceError) return error.code;
    throw error;
  }
  return undefined;
}

describe("registry store", () => {
  it("creates spaces.json on the first write and leaves no temporary or lock file", async () => {
    await createStoredSpace(files, "Experiments");
    const read = readRegistryFile(files.registryPath);
    expect(listSpaces(read.registry).map((s) => s.name)).toEqual(["Default", "Experiments"]);
    expect(readdirSync(dir).sort()).toEqual(["spaces", "spaces.json"]);
  });

  it("creates the space folder with the registry entry", async () => {
    const space = await createStoredSpace(files, "Client work");
    expect(existsSync(join(files.spacesRoot, space.id))).toBe(true);
  });

  it("creates, renames, switches, archives and unarchives", async () => {
    await createStoredSpace(files, "Experiments");
    await createStoredSpace(files, "Client work");
    await renameStoredSpace(files, "experiments", "Lab");
    await switchStoredSpace(files, "lab");
    await archiveStoredSpace(files, "client-work");
    let read = readRegistryFile(files.registryPath).registry;
    expect(read.activeSpaceId).toBe("experiments");
    expect(listSpaces(read).find((s) => s.id === "client-work")?.archived).toBe(true);
    await unarchiveStoredSpace(files, "client-work");
    read = readRegistryFile(files.registryPath).registry;
    expect(listSpaces(read).find((s) => s.id === "client-work")?.archived).toBe(false);
  });

  it("refuses to archive the active space and to switch to an archived one", async () => {
    await createStoredSpace(files, "Experiments");
    await switchStoredSpace(files, "experiments");
    expect(await codeOf(() => archiveStoredSpace(files, "experiments"))).toBe("active");
    await switchStoredSpace(files, "default");
    await archiveStoredSpace(files, "experiments");
    expect(await codeOf(() => switchStoredSpace(files, "experiments"))).toBe("archived");
  });

  it("does not change the file when an operation is refused", async () => {
    await createStoredSpace(files, "Experiments");
    const before = readFileSync(files.registryPath, "utf-8");
    await codeOf(() => createStoredSpace(files, "experiments"));
    expect(readFileSync(files.registryPath, "utf-8")).toBe(before);
  });

  it("loses no update when separate processes write at once", async () => {
    const names = Array.from({ length: 8 }, (_, i) => `Space ${i}`);
    const storeModule = join(import.meta.dir, "../src/services/spaces/registry-store.ts");
    const script =
      `import { spaceFiles, createStoredSpace } from ${JSON.stringify(storeModule)};` +
      `await createStoredSpace(spaceFiles(process.argv[1]), process.argv[2]);`;
    const children = names.map((name) =>
      Bun.spawn([process.execPath, "-e", script, dir, name], { stdout: "pipe", stderr: "pipe" })
    );
    const exits = await Promise.all(children.map((child) => child.exited));
    expect(exits).toEqual(names.map(() => 0));
    const read = readRegistryFile(files.registryPath);
    expect(read.problem).toBeUndefined();
    expect(
      listSpaces(read.registry)
        .map((s) => s.name)
        .slice(1)
        .sort()
    ).toEqual([...names].sort());
    expect(existsSync(files.lockPath)).toBe(false);
  });

  it("takes over a lock whose owner process is gone", async () => {
    writeFileSync(files.lockPath, JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }));
    await createStoredSpace(files, "Experiments");
    expect(existsSync(files.lockPath)).toBe(false);
  });

  it("refuses to overwrite a registry file that cannot be read", async () => {
    writeFileSync(files.registryPath, "{broken");
    expect(await codeOf(() => createStoredSpace(files, "Experiments"))).toBe("unreadable");
    expect(readFileSync(files.registryPath, "utf-8")).toBe("{broken");
  });
});
