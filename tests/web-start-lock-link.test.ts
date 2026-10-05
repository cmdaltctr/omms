import { afterAll, afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import fs from "node:fs";
import type { LockFs } from "../src/services/web-ensure.js";

// Bun's named builtin imports do not observe spies on the default export.
// Route the named import through that export before loading the start rule.
mock.module("node:fs", () => ({
  ...fs,
  default: fs,
  linkSync: (from: fs.PathLike, to: fs.PathLike) => fs.linkSync(from, to),
}));
const { nodeLockFs, takeStartLock } = await import("../src/services/web-ensure.js");
afterAll(() => mock.module("node:fs", () => ({ ...fs, default: fs })));

const platform = process.platform;
const waits: number[] = [];
const busy = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "win32" });
  waits.length = 0;
  spyOn(Atomics, "wait").mockImplementation((_array, _index, _value, timeout) => {
    waits.push(timeout ?? 0);
    return "timed-out";
  });
});

afterEach(() => {
  mock.restore();
  Object.defineProperty(process, "platform", { value: platform });
});

it.each(["EPERM", "EACCES", "EBUSY"])("retries temporary Windows %s before linking", (code) => {
  const link = spyOn(fs, "linkSync")
    .mockImplementationOnce(() => {
      throw busy(code);
    })
    .mockImplementationOnce(() => {
      throw busy(code);
    })
    .mockImplementation(() => {});
  expect(nodeLockFs.link("lock", "tomb")).toBe(true);
  expect(link).toHaveBeenCalledTimes(3);
  expect(waits).toEqual([1, 2]);
});

it.each(["EEXIST", "ENOENT"])("loses the claim when a retry returns %s", (code) => {
  const link = spyOn(fs, "linkSync")
    .mockImplementationOnce(() => {
      throw busy("EPERM");
    })
    .mockImplementation(() => {
      throw busy(code);
    });
  expect(nodeLockFs.link("lock", "tomb")).toBe(false);
  expect(link).toHaveBeenCalledTimes(2);
  expect(waits).toEqual([1]);
});

it("throws persistent Windows permission errors after the bounded waits", () => {
  const error = busy("EPERM");
  const link = spyOn(fs, "linkSync").mockImplementation(() => {
    throw error;
  });
  expect(() => nodeLockFs.link("lock", "tomb")).toThrow(error);
  expect(waits).toEqual([1, 2, 5, 10, 20, 50, 100, 200]);
  expect(link).toHaveBeenCalledTimes(9);
});

it.each(["linux", "darwin"])("throws permission errors immediately on %s", (host) => {
  Object.defineProperty(process, "platform", { value: host });
  const error = busy("EPERM");
  const link = spyOn(fs, "linkSync").mockImplementation(() => {
    throw error;
  });
  expect(() => nodeLockFs.link("lock", "tomb")).toThrow(error);
  expect(link).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([]);
});

it("throws unrelated Windows errors immediately", () => {
  const error = busy("EIO");
  const link = spyOn(fs, "linkSync").mockImplementation(() => {
    throw error;
  });
  expect(() => nodeLockFs.link("lock", "tomb")).toThrow(error);
  expect(link).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([]);
});

it.each(["EEXIST", "ENOENT"])("keeps an immediate %s as a lost claim", (code) => {
  const link = spyOn(fs, "linkSync").mockImplementation(() => {
    throw busy(code);
  });
  expect(nodeLockFs.link("lock", "tomb")).toBe(false);
  expect(link).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([]);
});

it("links without waiting when the first attempt succeeds", () => {
  const link = spyOn(fs, "linkSync").mockImplementation(() => {});
  expect(nodeLockFs.link("lock", "tomb")).toBe(true);
  expect(link).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([]);
});

it("leaves exactly one winner when another caller takes over during a Windows retry", () => {
  const lock = "lock";
  const stale = JSON.stringify({ pid: 999, at: 1_000 });
  const files = new Map([[lock, stale]]);
  const disk: LockFs = {
    createExclusive(path, text) {
      if (files.has(path)) return false;
      files.set(path, text);
      return true;
    },
    read: (path) => files.get(path) ?? null,
    remove: (path) => {
      files.delete(path);
    },
    link: nodeLockFs.link,
    ageMs: () => 0,
    replace: (path, text) => {
      files.set(path, text);
    },
  };
  spyOn(fs, "linkSync")
    .mockImplementationOnce(() => {
      throw busy("EPERM");
    })
    .mockImplementation((from, to) => {
      const text = files.get(String(from));
      if (text === undefined) throw busy("ENOENT");
      if (files.has(String(to))) throw busy("EEXIST");
      files.set(String(to), text);
    });
  const deps = {
    lockPath: lock,
    lockFs: disk,
    pid: 100,
    now: () => 100_000,
    pidAlive: (pid: number) => pid !== 999,
  };
  let otherHeld = false;
  spyOn(Atomics, "wait").mockImplementationOnce(() => {
    otherHeld = takeStartLock({ ...deps, pid: 200 });
    return "timed-out";
  });
  const held = takeStartLock(deps);
  expect([held, otherHeld].filter(Boolean)).toHaveLength(1);
  expect(held).toBe(false);
  expect(otherHeld).toBe(true);
  expect(JSON.parse(files.get(lock)!)).toMatchObject({ pid: 200 });
  expect([...files.keys()]).toEqual([lock]);
});
