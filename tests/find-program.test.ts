import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { findProgram } from "../src/services/find-program.js";

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "omms-find-program-"));
  roots.push(root);
  return root;
}

/** The host's own rules: Windows needs a `PATHEXT` extension, other systems need the execute bit. */
const hostPlatform = process.platform;
const hostExtension = hostPlatform === "win32" ? ".cmd" : "";

function fakeBinary(folder: string, name: string): string {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${name}${hostExtension}`);
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** An `isFile` that knows exactly these paths. Linux rules need no real file system. */
const knows = (...paths: string[]) => {
  const set = new Set(paths);
  return (path: string) => set.has(path);
};

describe("findProgram on the host file system", () => {
  const host = (bin: string) => ({
    env: { PATH: bin, PATHEXT: ".CMD" },
    platform: hostPlatform,
  });

  it("finds a binary on a scratch PATH", () => {
    const bin = join(scratch(), "bin");
    const expected = fakeBinary(bin, "opencode");
    expect(findProgram("opencode", [], host(bin))).toBe(expected);
  });

  it("searches the extra folders after PATH", () => {
    const root = scratch();
    const extra = join(root, "extra");
    const expected = fakeBinary(extra, "pi");
    expect(findProgram("pi", [extra], host(join(root, "empty")))).toBe(expected);
  });

  it("prefers PATH over the extra folders", () => {
    const root = scratch();
    const onPath = fakeBinary(join(root, "path"), "claude");
    fakeBinary(join(root, "extra"), "claude");
    expect(findProgram("claude", [join(root, "extra")], host(join(root, "path")))).toBe(onPath);
  });

  it("returns null when the binary is absent", () => {
    const root = scratch();
    expect(findProgram("opencode", [join(root, "extra")], host(join(root, "bin")))).toBeNull();
  });

  it("ignores a folder that holds a directory of the same name", () => {
    const root = scratch();
    mkdirSync(join(root, "bin", `opencode${hostExtension}`), { recursive: true });
    expect(findProgram("opencode", [], host(join(root, "bin")))).toBeNull();
  });
});

describe("findProgram on linux", () => {
  const linux = (env: Record<string, string>, isFile: (path: string) => boolean) => ({
    env,
    platform: "linux" as const,
    isFile,
  });

  it("splits PATH on colons", () => {
    const found = findProgram("pi", [], linux({ PATH: "/usr/a:/usr/b" }, knows("/usr/b/pi")));
    expect(found).toBe("/usr/b/pi");
  });

  it("searches the extra folders after PATH", () => {
    const found = findProgram(
      "pi",
      ["/opt/extra"],
      linux({ PATH: "/usr/a" }, knows("/opt/extra/pi"))
    );
    expect(found).toBe("/opt/extra/pi");
  });

  it("prefers PATH over the extra folders", () => {
    const isFile = knows("/usr/a/claude", "/opt/extra/claude");
    const found = findProgram("claude", ["/opt/extra"], linux({ PATH: "/usr/a" }, isFile));
    expect(found).toBe("/usr/a/claude");
  });

  it("returns null when the binary is absent", () => {
    expect(findProgram("opencode", ["/opt/extra"], linux({ PATH: "/usr/a" }, knows()))).toBeNull();
  });

  it("never looks outside the folders it is given", () => {
    const seen: string[] = [];
    const found = findProgram(
      "opencode",
      ["/opt/extra"],
      linux({ PATH: "/usr/a" }, (path) => {
        seen.push(path);
        return false;
      })
    );
    expect(found).toBeNull();
    expect(seen).toEqual([posix.join("/usr/a", "opencode"), posix.join("/opt/extra", "opencode")]);
  });
});

describe("findProgram on win32", () => {
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
