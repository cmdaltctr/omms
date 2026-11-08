import { afterEach, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CACHE_PRUNE_MIN_AGE_MS,
  installedVersions,
  listHostCopies,
  pruneOldCacheCopies,
} from "../src/services/host-copies.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An empty OpenCode-style cache folder under the system temp folder. */
function cacheFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "omms-host-copies-"));
  tempDirs.push(dir);
  const cache = join(dir, "om-memory-system@latest");
  mkdirSync(cache, { recursive: true });
  return cache;
}

/** Put a copy at `<cache>/<stamp>/node_modules/om-memory-system`. A null version writes no package.json. */
function addCopy(cache: string, stamp: number, version: string | null): string {
  const root = join(cache, String(stamp), "node_modules", "om-memory-system");
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "plugin.js"), "// copy");
  if (version !== null) {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "om-memory-system", version })
    );
  }
  return root;
}

const modulePathOf = (root: string): string => join(root, "dist", "plugin.js");

const RUNNING = 1_700_000_000_000;
const DAY = CACHE_PRUNE_MIN_AGE_MS;

it("keeps the minimum age at 24 hours", () => {
  expect(CACHE_PRUNE_MIN_AGE_MS).toBe(24 * 60 * 60 * 1000);
});

it("lists the running copy and its timestamp siblings with versions", () => {
  const cache = cacheFolder();
  const running = addCopy(cache, RUNNING, "4.3.0");
  const older = addCopy(cache, RUNNING - 5_000, "4.2.0");
  const newer = addCopy(cache, RUNNING + 5_000, "4.4.0");

  const copies = listHostCopies(modulePathOf(running));
  expect(copies).toEqual({
    root: running,
    version: "4.3.0",
    stamp: RUNNING,
    siblings: [
      { root: older, version: "4.2.0", stamp: RUNNING - 5_000 },
      { root: newer, version: "4.4.0", stamp: RUNNING + 5_000 },
    ],
  });
});

it("gives a sibling without a readable package.json a null version", () => {
  const cache = cacheFolder();
  const running = addCopy(cache, RUNNING, "4.3.0");
  const broken = addCopy(cache, RUNNING - 1, null);
  expect(listHostCopies(modulePathOf(running))!.siblings).toEqual([
    { root: broken, version: null, stamp: RUNNING - 1 },
  ]);
});

it("ignores sibling folders whose names are not all digits", () => {
  const cache = cacheFolder();
  const running = addCopy(cache, RUNNING, "4.3.0");
  mkdirSync(join(cache, "latest"));
  mkdirSync(join(cache, "12ab"));
  writeFileSync(join(cache, "99999"), "a file, not a folder");
  expect(listHostCopies(modulePathOf(running))!.siblings).toEqual([]);
});

it("lists no siblings when the folder above node_modules is not a timestamp", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-host-copies-"));
  tempDirs.push(dir);
  const root = join(dir, "npm", "node_modules", "om-memory-system");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "om-memory-system", version: "4.3.0" })
  );
  mkdirSync(join(dir, "npm", "node_modules", "other"), { recursive: true });
  expect(listHostCopies(modulePathOf(root))).toEqual({
    root,
    version: "4.3.0",
    stamp: null,
    siblings: [],
  });
});

it("returns null when the module is not inside node_modules/om-memory-system", () => {
  expect(listHostCopies("/work/omms/src/v2/plugin.ts")).toBeNull();
  expect(listHostCopies("/cache/node_modules/other-package/dist/a.js")).toBeNull();
});

it("reads a Windows module path with backslashes", () => {
  const path =
    "C:\\cache\\om-memory-system@latest\\1700000000000\\node_modules\\om-memory-system\\dist\\a.js";
  const copies = listHostCopies(path);
  expect(copies).not.toBeNull();
  expect(copies!.root).toBe(
    "C:\\cache\\om-memory-system@latest\\1700000000000\\node_modules\\om-memory-system"
  );
  expect(copies!.stamp).toBe(1_700_000_000_000);
  // The folder does not exist on this machine, so nothing can be read.
  expect(copies!.version).toBeNull();
  expect(copies!.siblings).toEqual([]);
});

it("lists the versions on disk: Pi updates in place, OpenCode adds a folder", () => {
  // Pi: one root, its package.json now shows the new version.
  const dir = mkdtempSync(join(tmpdir(), "omms-host-copies-"));
  tempDirs.push(dir);
  const piRoot = join(dir, "npm", "node_modules", "om-memory-system");
  mkdirSync(piRoot, { recursive: true });
  writeFileSync(
    join(piRoot, "package.json"),
    JSON.stringify({ name: "om-memory-system", version: "4.3.0" })
  );
  expect(installedVersions(modulePathOf(piRoot))).toEqual(["4.3.0"]);

  // OpenCode: the running folder holds 4.2.0, a new sibling holds 4.3.0, a third has no version.
  const cache = cacheFolder();
  const running = addCopy(cache, RUNNING, "4.2.0");
  addCopy(cache, RUNNING + 10, "4.3.0");
  addCopy(cache, RUNNING + 20, null);
  expect(installedVersions(modulePathOf(running)).sort()).toEqual(["4.2.0", "4.3.0"]);
});

it("lists no versions for a path outside an npm install and never throws", async () => {
  expect(installedVersions("/work/omms/src/v2/plugin.ts")).toEqual([]);
  expect(installedVersions("")).toEqual([]);
});

/** Run the clean-up for a cache that has a running copy `daysOld` old, plus the given extra copies. */
async function prune(options: {
  runningVersion?: string;
  runningAgeMs?: number;
  copies?: [stamp: number, version: string | null][];
  keep?: (cache: string) => string[];
  remove?: (folder: string) => void | Promise<void>;
  log?: (message: string, data: Record<string, unknown>) => void | Promise<void>;
}) {
  const cache = cacheFolder();
  const running = addCopy(cache, RUNNING, options.runningVersion ?? "4.3.0");
  const roots = new Map<number, string>();
  for (const [stamp, version] of options.copies ?? [])
    roots.set(stamp, addCopy(cache, stamp, version));
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  const result = await pruneOldCacheCopies({
    modulePath: modulePathOf(running),
    runningVersion: options.runningVersion ?? "4.3.0",
    keepRoots: options.keep?.(cache) ?? [],
    now: RUNNING + (options.runningAgeMs ?? 2 * DAY),
    remove: options.remove,
    log: options.log ?? ((message, data) => void logs.push({ message, data })),
  });
  return { cache, running, roots, logs, result, stamp: (n: number) => join(cache, String(n)) };
}

it("removes an older copy with an older version, and nothing else", async () => {
  const t = await prune({
    copies: [
      [RUNNING - 1_000, "4.2.0"],
      [RUNNING - 2_000, "4.1.0"],
    ],
  });
  expect(t.result).toEqual({ removed: 2, kept: 0 });
  expect(existsSync(t.stamp(RUNNING - 1_000))).toBe(false);
  expect(existsSync(t.stamp(RUNNING - 2_000))).toBe(false);
  // The running folder stays, with the files it needs.
  expect(existsSync(join(t.running, "dist", "plugin.js"))).toBe(true);
});

it("keeps a newer copy, an unreadable copy and a copy with an equal or newer version", async () => {
  const t = await prune({
    copies: [
      [RUNNING + 1_000, "4.4.0"],
      [RUNNING - 1_000, null],
      [RUNNING - 2_000, "4.3.0"],
      [RUNNING - 3_000, "4.5.0"],
      [RUNNING + 2_000, "4.0.0"],
    ],
  });
  // Only the three copies with an older timestamp count as considered; none is removed.
  expect(t.result).toEqual({ removed: 0, kept: 3 });
  for (const stamp of [
    RUNNING + 1_000,
    RUNNING - 1_000,
    RUNNING - 2_000,
    RUNNING - 3_000,
    RUNNING + 2_000,
  ]) {
    expect(existsSync(t.stamp(stamp))).toBe(true);
  }
});

it("keeps the copy that runtime.json records", async () => {
  const t = await prune({
    copies: [
      [RUNNING - 1_000, "4.2.0"],
      [RUNNING - 2_000, "4.1.0"],
    ],
    keep: (cache) => [join(cache, String(RUNNING - 1_000), "node_modules", "om-memory-system")],
  });
  expect(t.result).toEqual({ removed: 1, kept: 1 });
  expect(existsSync(t.stamp(RUNNING - 1_000))).toBe(true);
  expect(existsSync(t.stamp(RUNNING - 2_000))).toBe(false);
});

it("treats a recorded root with a trailing slash or backslashes as the same copy", async () => {
  const t = await prune({
    copies: [[RUNNING - 1_000, "4.2.0"]],
    keep: (cache) => [
      `${join(cache, String(RUNNING - 1_000), "node_modules", "om-memory-system")}/`,
    ],
  });
  expect(t.result).toEqual({ removed: 0, kept: 1 });
});

it("removes nothing while the running copy is under 24 hours old, and removes at exactly 24 hours", async () => {
  const recent = await prune({ copies: [[RUNNING - 1_000, "4.2.0"]], runningAgeMs: DAY - 1 });
  expect(recent.result).toEqual({ removed: 0, kept: 1 });
  expect(existsSync(recent.stamp(RUNNING - 1_000))).toBe(true);

  const exact = await prune({ copies: [[RUNNING - 1_000, "4.2.0"]], runningAgeMs: DAY });
  expect(exact.result).toEqual({ removed: 1, kept: 0 });
  expect(existsSync(exact.stamp(RUNNING - 1_000))).toBe(false);
});

it("keeps a folder that cannot be removed, counts it, and still removes the others", async () => {
  const attempts: string[] = [];
  const t = await prune({
    copies: [
      [RUNNING - 1_000, "4.2.0"],
      [RUNNING - 2_000, "4.1.0"],
    ],
    remove: (folder) => {
      attempts.push(folder);
      if (folder.endsWith(String(RUNNING - 1_000))) throw new Error("EBUSY");
    },
  });
  expect(attempts).toHaveLength(2);
  expect(t.result).toEqual({ removed: 1, kept: 1 });
  expect(existsSync(t.stamp(RUNNING - 1_000))).toBe(true);
});

it("removes the timestamp folder, not only the package folder", async () => {
  const removed: string[] = [];
  const t = await prune({
    copies: [[RUNNING - 1_000, "4.2.0"]],
    remove: (folder) => void removed.push(folder),
  });
  expect(removed).toEqual([t.stamp(RUNNING - 1_000)]);
});

it("writes one record with counts only when an older copy was considered", async () => {
  const t = await prune({
    copies: [
      [RUNNING - 1_000, "4.2.0"],
      [RUNNING - 2_000, null],
    ],
  });
  expect(t.logs).toEqual([{ message: "OpenCode cache clean-up", data: { removed: 1, kept: 1 } }]);
  // No path or file text in the record.
  expect(JSON.stringify(t.logs)).not.toContain(tmpdir());
});

it("writes the record even when the 24 hour wait keeps every older copy", async () => {
  const t = await prune({ copies: [[RUNNING - 1_000, "4.2.0"]], runningAgeMs: 1_000 });
  expect(t.logs).toEqual([{ message: "OpenCode cache clean-up", data: { removed: 0, kept: 1 } }]);
});

it("writes a zero-count record when no older copy exists, so the pass is visible", async () => {
  const none = await prune({ copies: [[RUNNING + 1_000, "4.4.0"]] });
  expect(none.result).toEqual({ removed: 0, kept: 0 });
  expect(none.logs).toEqual([
    { message: "OpenCode cache clean-up", data: { removed: 0, kept: 0 } },
  ]);
});

it("removes nothing when the numeric folders are not an OpenCode cache", async () => {
  // A project folder named with digits, next to another one that also holds an older OMMS.
  const dir = mkdtempSync(join(tmpdir(), "omms-host-copies-"));
  tempDirs.push(dir);
  const projects = join(dir, "projects");
  const running = addCopy(projects, 2024, "4.3.0");
  const other = addCopy(projects, 2023, "4.2.0");
  writeFileSync(join(projects, "2023", "keep-me.txt"), "user data");
  expect(listHostCopies(modulePathOf(running))!.stamp).toBeNull();
  const logs: unknown[] = [];
  const result = await pruneOldCacheCopies({
    modulePath: modulePathOf(running),
    runningVersion: "4.3.0",
    keepRoots: [],
    now: Date.now(),
    log: (message) => void logs.push(message),
  });
  expect(result).toEqual({ removed: 0, kept: 0 });
  expect(logs).toEqual([]);
  expect(existsSync(other)).toBe(true);
  expect(existsSync(join(projects, "2023", "keep-me.txt"))).toBe(true);
});

it("removes nothing under a project folder named like the package, without a version spec", async () => {
  // A checkout named om-memory-system with numeric folders is not OpenCode's om-memory-system@latest cache.
  const dir = mkdtempSync(join(tmpdir(), "omms-host-copies-"));
  tempDirs.push(dir);
  const project = join(dir, "om-memory-system");
  const running = addCopy(project, 2024, "4.3.0");
  const other = addCopy(project, 2023, "4.2.0");
  writeFileSync(join(project, "2023", "keep-me.txt"), "user data");
  expect(listHostCopies(modulePathOf(running))!.stamp).toBeNull();
  const result = await pruneOldCacheCopies({
    modulePath: modulePathOf(running),
    runningVersion: "4.3.0",
    keepRoots: [],
    now: Date.now(),
    log: () => {},
  });
  expect(result).toEqual({ removed: 0, kept: 0 });
  expect(existsSync(other)).toBe(true);
  expect(existsSync(join(project, "2023", "keep-me.txt"))).toBe(true);
});

it("does nothing and writes no record outside a timestamp folder", async () => {
  const logs: unknown[] = [];
  const result = await pruneOldCacheCopies({
    modulePath: "/work/omms/src/v2/plugin.ts",
    runningVersion: "4.3.0",
    keepRoots: [],
    now: Date.now(),
    log: (message) => void logs.push(message),
  });
  expect(result).toEqual({ removed: 0, kept: 0 });
  expect(logs).toEqual([]);
});

it("removes nothing when the running version cannot be placed", async () => {
  const t = await prune({ runningVersion: "unknown", copies: [[RUNNING - 1_000, "4.2.0"]] });
  expect(t.result).toEqual({ removed: 0, kept: 1 });
  expect(existsSync(t.stamp(RUNNING - 1_000))).toBe(true);
});

it("never throws when the log fails or the log returns a rejected promise", async () => {
  const sync = await prune({
    copies: [[RUNNING - 1_000, "4.2.0"]],
    log: () => {
      throw new Error("disk full");
    },
  });
  expect(sync.result).toEqual({ removed: 1, kept: 0 });

  const asyncFail = await prune({
    copies: [[RUNNING - 1_000, "4.2.0"]],
    log: () => Promise.reject(new Error("disk full")),
  });
  expect(asyncFail.result).toEqual({ removed: 1, kept: 0 });
  // Let the rejected promise settle; an unhandled rejection would fail the run.
  await new Promise((resolve) => setTimeout(resolve, 10));
});

it("waits for an asynchronous removal and counts a rejected one as kept", async () => {
  let finished = 0;
  const t = await prune({
    copies: [
      [RUNNING - 1_000, "4.2.0"],
      [RUNNING - 2_000, "4.1.0"],
    ],
    remove: async (folder) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (folder.endsWith(String(RUNNING - 2_000))) throw new Error("EBUSY");
      finished++;
    },
  });
  expect(finished).toBe(1);
  expect(t.result).toEqual({ removed: 1, kept: 1 });
  expect(t.logs).toEqual([{ message: "OpenCode cache clean-up", data: { removed: 1, kept: 1 } }]);
});

it("keeps a recorded copy named through a symbolic link", async () => {
  const links = mkdtempSync(join(tmpdir(), "omms-copy-link-"));
  tempDirs.push(links);
  const t = await prune({
    copies: [[RUNNING - 1_000, "4.2.0"]],
    keep: (cache) => {
      const link = join(links, "recorded");
      // A junction needs no symbolic-link privilege on Windows; other systems treat it as a symbolic link.
      symlinkSync(
        join(cache, String(RUNNING - 1_000), "node_modules", "om-memory-system"),
        link,
        "junction"
      );
      return [link];
    },
  });
  expect(t.result).toEqual({ removed: 0, kept: 1 });
  expect(existsSync(t.stamp(RUNNING - 1_000))).toBe(true);
});
