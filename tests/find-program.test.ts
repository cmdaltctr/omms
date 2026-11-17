import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { findProgram } from "../src/services/find-program.js";

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "omms-find-program-"));
  roots.push(root);
  return root;
}

function fakeBinary(folder: string, file: string): string {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, file);
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("findProgram", () => {
  it("finds a binary on a scratch PATH", () => {
    const bin = join(scratch(), "bin");
    const expected = fakeBinary(bin, "opencode");
    expect(findProgram("opencode", [], { env: { PATH: bin }, platform: "linux" })).toBe(expected);
  });

  it("searches the extra folders after PATH", () => {
    const root = scratch();
    const extra = join(root, "extra");
    const expected = fakeBinary(extra, "pi");
    const env = { PATH: join(root, "empty") };
    expect(findProgram("pi", [extra], { env, platform: "linux" })).toBe(expected);
  });

  it("prefers PATH over the extra folders", () => {
    const root = scratch();
    const onPath = fakeBinary(join(root, "path"), "claude");
    fakeBinary(join(root, "extra"), "claude");
    const found = findProgram("claude", [join(root, "extra")], {
      env: { PATH: join(root, "path") },
      platform: "linux",
    });
    expect(found).toBe(onPath);
  });

  it("returns null when the binary is absent", () => {
    const root = scratch();
    expect(
      findProgram("opencode", [join(root, "extra")], {
        env: { PATH: join(root, "bin") },
        platform: "linux",
      })
    ).toBeNull();
  });

  it("never looks outside the folders it is given", () => {
    const root = scratch();
    fakeBinary(join(root, "elsewhere"), "opencode");
    const seen: string[] = [];
    const found = findProgram("opencode", [join(root, "extra")], {
      env: { PATH: join(root, "bin") },
      platform: "linux",
      isFile: (path) => {
        seen.push(path);
        return false;
      },
    });
    expect(found).toBeNull();
    expect(seen).toEqual([join(root, "bin", "opencode"), join(root, "extra", "opencode")]);
  });

  it("ignores a folder that holds a directory of the same name", () => {
    const root = scratch();
    mkdirSync(join(root, "bin", "opencode"), { recursive: true });
    expect(
      findProgram("opencode", [], { env: { PATH: join(root, "bin") }, platform: "linux" })
    ).toBeNull();
  });

  describe("on win32", () => {
    const folder = "C:\\tools";
    const present = (...files: string[]) => {
      const set = new Set(files.map((file) => win32.join(folder, file)));
      return (path: string) => set.has(path);
    };

    it("tries each PATHEXT extension in order", () => {
      const found = findProgram("opencode", [], {
        env: { PATH: folder, PATHEXT: ".EXE;.CMD" },
        platform: "win32",
        isFile: present("opencode.CMD"),
      });
      expect(found).toBe(win32.join(folder, "opencode.CMD"));
    });

    it("falls back to the default extensions without PATHEXT", () => {
      const found = findProgram("pi", [], {
        env: { PATH: folder },
        platform: "win32",
        isFile: present("pi.cmd"),
      });
      expect(found).toBe(win32.join(folder, "pi.cmd"));
    });

    it("reads Path in any letter case and splits on semicolons", () => {
      const found = findProgram("claude", [], {
        env: { Path: `C:\\other;"${folder}"`, PATHEXT: ".EXE" },
        platform: "win32",
        isFile: present("claude.EXE"),
      });
      expect(found).toBe(win32.join(folder, "claude.EXE"));
    });

    it("does not match the bare name", () => {
      const found = findProgram("claude", [], {
        env: { PATH: folder, PATHEXT: ".EXE" },
        platform: "win32",
        isFile: present("claude"),
      });
      expect(found).toBeNull();
    });
  });
});
