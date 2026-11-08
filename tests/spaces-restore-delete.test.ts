import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupSpace } from "../src/services/spaces/backup.js";
import { deleteSpace } from "../src/services/spaces/delete.js";
import { SpaceError, listSpaces, readRegistryFile } from "../src/services/spaces/registry.js";
import {
  createStoredSpace,
  spaceFiles,
  switchStoredSpace,
} from "../src/services/spaces/registry-store.js";
import { listBackups, restoreBackup } from "../src/services/spaces/restore.js";

let root: string;
let files: ReturnType<typeof spaceFiles>;
let experimentsId: string;
const version = "9.9.9";

function folderOf(id: string) {
  return join(files.spacesRoot, id);
}

/** One hash over every file of a folder, so any byte change shows. */
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(entry.name).update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

async function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SpaceError) return error.code;
    throw error;
  }
  return undefined;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omms-restore-"));
  files = spaceFiles(root);
  experimentsId = (await createStoredSpace(files, "Experiments")).id;
  writeFileSync(join(folderOf(experimentsId), "cold-buffer.json"), '{"keep":"me"}');
  mkdirSync(join(folderOf(experimentsId), "projects"), { recursive: true });
  writeFileSync(join(folderOf(experimentsId), "projects", "note.txt"), "project file");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("restoreBackup", () => {
  it("creates a new space named after the backup and leaves the original untouched", async () => {
    const { backupPath } = await backupSpace({
      space: { id: experimentsId, name: "Experiments" },
      spaceFolder: folderOf(experimentsId),
      backupsRoot: files.backupsRoot,
      ommsVersion: version,
      now: new Date("2026-11-06T10:00:00Z"),
    });
    const before = treeHash(folderOf(experimentsId));
    const restored = await restoreBackup(files, backupPath, new Date("2026-11-07T09:00:00Z"));
    expect(restored.name).toBe("Experiments (restored 2026-11-07)");
    expect(readFileSync(join(folderOf(restored.id), "cold-buffer.json"), "utf-8")).toBe(
      '{"keep":"me"}'
    );
    expect(readFileSync(join(folderOf(restored.id), "projects", "note.txt"), "utf-8")).toBe(
      "project file"
    );
    expect(treeHash(folderOf(experimentsId))).toBe(before);
  });

  it("does not change the active space", async () => {
    const { backupPath } = await backupSpace({
      space: { id: experimentsId, name: "Experiments" },
      spaceFolder: folderOf(experimentsId),
      backupsRoot: files.backupsRoot,
      ommsVersion: version,
    });
    await switchStoredSpace(files, experimentsId);
    await restoreBackup(files, backupPath);
    expect(readRegistryFile(files.registryPath).registry.activeSpaceId).toBe(experimentsId);
  });

  it("restores the same backup twice into two different spaces", async () => {
    const { backupPath } = await backupSpace({
      space: { id: experimentsId, name: "Experiments" },
      spaceFolder: folderOf(experimentsId),
      backupsRoot: files.backupsRoot,
      ommsVersion: version,
    });
    const first = await restoreBackup(files, backupPath);
    const second = await restoreBackup(files, backupPath);
    expect(second.id).not.toBe(first.id);
    expect(second.name).not.toBe(first.name);
  });

  it("refuses a damaged backup, names the file and creates no space", async () => {
    const { backupPath } = await backupSpace({
      space: { id: experimentsId, name: "Experiments" },
      spaceFolder: folderOf(experimentsId),
      backupsRoot: files.backupsRoot,
      ommsVersion: version,
    });
    writeFileSync(join(backupPath, "cold-buffer.json"), "tampered!!");
    const before = listSpaces(readRegistryFile(files.registryPath).registry).length;
    await expect(restoreBackup(files, backupPath)).rejects.toThrow(/cold-buffer\.json/);
    expect(listSpaces(readRegistryFile(files.registryPath).registry).length).toBe(before);
    expect(readdirSync(files.spacesRoot)).toEqual([experimentsId]);
  });

  it("refuses a folder that is not a space backup", async () => {
    const stray = join(root, "stray");
    mkdirSync(stray);
    await expect(restoreBackup(files, stray)).rejects.toThrow(/backup/);
  });
});

describe("listBackups", () => {
  it("lists space backups newest first with name, date and size", async () => {
    const make = (iso: string) =>
      backupSpace({
        space: { id: experimentsId, name: "Experiments" },
        spaceFolder: folderOf(experimentsId),
        backupsRoot: files.backupsRoot,
        ommsVersion: version,
        now: new Date(iso),
      });
    await make("2026-11-05T10:00:00Z");
    await make("2026-11-06T10:00:00Z");
    mkdirSync(join(files.backupsRoot, "not-a-space-backup"));
    const list = listBackups(files.backupsRoot);
    expect(list.map((b) => b.createdAt)).toEqual([
      "2026-11-06T10:00:00.000Z",
      "2026-11-05T10:00:00.000Z",
    ]);
    expect(list[0]).toMatchObject({ spaceName: "Experiments", fileCount: 2 });
    expect(list[0]!.sizeBytes).toBeGreaterThan(0);
  });

  it("returns an empty list when there is no backups folder", () => {
    expect(listBackups(join(root, "none"))).toEqual([]);
  });
});

describe("deleteSpace", () => {
  it("refuses the Default space and the active space", async () => {
    expect(await codeOf(() => deleteSpace(files, "default", { ommsVersion: version }))).toBe(
      "protected"
    );
    await switchStoredSpace(files, experimentsId);
    expect(await codeOf(() => deleteSpace(files, experimentsId, { ommsVersion: version }))).toBe(
      "active"
    );
    expect(existsSync(folderOf(experimentsId))).toBe(true);
    expect(existsSync(files.backupsRoot)).toBe(false);
  });

  it("makes a verified backup, removes the entry and the folder, and returns the backup path", async () => {
    const result = await deleteSpace(files, experimentsId, { ommsVersion: version });
    expect(existsSync(folderOf(experimentsId))).toBe(false);
    expect(
      listSpaces(readRegistryFile(files.registryPath).registry).some((s) => s.id === experimentsId)
    ).toBe(false);
    expect(readFileSync(join(result.backupPath, "cold-buffer.json"), "utf-8")).toBe(
      '{"keep":"me"}'
    );
    expect(result.leftoverFolder).toBeUndefined();
  });

  it("keeps the space when the backup fails", async () => {
    const failing = {
      backup: async () => {
        throw new Error("disk full");
      },
    };
    await expect(
      deleteSpace(files, experimentsId, { ommsVersion: version }, failing)
    ).rejects.toThrow(/disk full/);
    expect(existsSync(folderOf(experimentsId))).toBe(true);
    expect(
      listSpaces(readRegistryFile(files.registryPath).registry).some((s) => s.id === experimentsId)
    ).toBe(true);
  });

  it("reports the folder when it cannot be removed after the entry is gone", async () => {
    const stuck = {
      removeFolder: () => {
        throw new Error("in use");
      },
    };
    const result = await deleteSpace(files, experimentsId, { ommsVersion: version }, stuck);
    expect(result.leftoverFolder).toBe(folderOf(experimentsId));
    expect(
      listSpaces(readRegistryFile(files.registryPath).registry).some((s) => s.id === experimentsId)
    ).toBe(false);
  });

  it("refuses an unknown space", async () => {
    expect(await codeOf(() => deleteSpace(files, "nope", { ommsVersion: version }))).toBe(
      "unknown"
    );
  });
});
