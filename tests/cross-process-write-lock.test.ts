import { afterEach, describe, expect, it, mock } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realFs = { ...fs };
let duringExclusiveCreate: (() => void) | undefined;
let linkErrors: NodeJS.ErrnoException[] = [];
const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;

function linkSync(from: fs.PathLike, to: fs.PathLike): void {
  const error = linkErrors.shift();
  if (error) throw error;
  realFs.linkSync(from, to);
}

function writeFileSync(...args: Parameters<typeof fs.writeFileSync>): void {
  const options = args[2];
  if (duringExclusiveCreate && typeof options === "object" && options?.flag === "wx") {
    // Pause after open, before writing the PID, as another process can do.
    const fd = realFs.openSync(args[0], "wx");
    const contender = duringExclusiveCreate;
    duringExclusiveCreate = undefined;
    try {
      contender();
      realFs.writeFileSync(fd, args[1], options);
    } finally {
      realFs.closeSync(fd);
    }
    return;
  }
  realFs.writeFileSync(...args);
}

mock.module("node:fs", () => ({
  ...realFs,
  default: { ...realFs, writeFileSync, linkSync },
  writeFileSync,
  linkSync,
}));

const { CONFIG } = await import("../src/config.js");
const { withCrossProcessWriteLock } =
  await import("../src/services/turso/cross-process-write-lock.js");
const previousStorage = CONFIG.storagePath;
const directories: string[] = [];
const hash = "a1b2c3d4e5f60718";

function storage(): string {
  const dir = realFs.mkdtempSync(join(tmpdir(), "omms-write-lock-"));
  directories.push(dir);
  CONFIG.storagePath = dir;
  return dir;
}

function lockPath(dir: string): string {
  return join(dir, ".write-locks", `project_${hash}.lock`);
}

afterEach(() => {
  duringExclusiveCreate = undefined;
  linkErrors = [];
  Object.defineProperty(process, "platform", platformDescriptor);
  CONFIG.storagePath = previousStorage;
  for (const dir of directories.splice(0)) realFs.rmSync(dir, { recursive: true, force: true });
});

describe("cross-process write lock", () => {
  it("keeps writers exclusive when a contender arrives before the PID is written", async () => {
    const dir = storage();
    let active = 0;
    let maximumActive = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let contender: Promise<void> | undefined;

    duringExclusiveCreate = () => {
      contender = withCrossProcessWriteLock("project", hash, async () => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await held;
        active--;
      });
    };
    const first = withCrossProcessWriteLock("project", hash, async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      active--;
    });
    try {
      await Promise.resolve();
    } finally {
      release();
      await Promise.all([first, contender]);
    }

    expect(contender).toBeDefined();
    expect(maximumActive).toBe(1);
    expect(realFs.existsSync(lockPath(dir))).toBe(false);
    expect(realFs.readdirSync(join(dir, ".write-locks"))).toEqual([]);
  });

  it("releases the lock after the writer throws", async () => {
    const dir = storage();
    await expect(
      withCrossProcessWriteLock("project", hash, async () => {
        throw new Error("write failed");
      })
    ).rejects.toThrow("write failed");
    expect(realFs.existsSync(lockPath(dir))).toBe(false);
    await expect(withCrossProcessWriteLock("project", hash, async () => "next")).resolves.toBe(
      "next"
    );
    expect(realFs.readdirSync(join(dir, ".write-locks"))).toEqual([]);
  });

  it("reports a publication error without entering the writer or leaving files", async () => {
    const dir = storage();
    const error = Object.assign(new Error("disk error"), { code: "EIO" });
    linkErrors = [error];
    let entered = false;
    await expect(
      withCrossProcessWriteLock("project", hash, async () => {
        entered = true;
      })
    ).rejects.toThrow("disk error");
    expect(entered).toBe(false);
    expect(realFs.readdirSync(join(dir, ".write-locks"))).toEqual([]);
  });

  it("retries temporary Windows refusals while publishing the complete lock", async () => {
    const dir = storage();
    Object.defineProperty(process, "platform", { value: "win32" });
    linkErrors = ["EPERM", "EACCES", "EBUSY"].map((code) =>
      Object.assign(new Error("busy"), { code })
    );
    await expect(withCrossProcessWriteLock("project", hash, async () => "written")).resolves.toBe(
      "written"
    );
    expect(linkErrors).toHaveLength(0);
    expect(realFs.readdirSync(join(dir, ".write-locks"))).toEqual([]);
  });

  it("bounds persistent Windows publication refusals and cleans up", async () => {
    const dir = storage();
    Object.defineProperty(process, "platform", { value: "win32" });
    linkErrors = Array.from({ length: 9 }, () =>
      Object.assign(new Error("permission refused"), { code: "EPERM" })
    );
    await expect(
      withCrossProcessWriteLock("project", hash, async () => "unreachable")
    ).rejects.toThrow("permission refused");
    expect(linkErrors).toHaveLength(0);
    expect(realFs.readdirSync(join(dir, ".write-locks"))).toEqual([]);
  });

  it("reclaims a lock whose owner process is dead", async () => {
    const dir = storage();
    realFs.mkdirSync(join(dir, ".write-locks"));
    realFs.writeFileSync(
      lockPath(dir),
      JSON.stringify({ pid: 2147483647, timestamp: new Date().toISOString() })
    );
    await expect(withCrossProcessWriteLock("project", hash, async () => "recovered")).resolves.toBe(
      "recovered"
    );
    expect(realFs.readdirSync(join(dir, ".write-locks"))).toEqual([]);
  });
});
