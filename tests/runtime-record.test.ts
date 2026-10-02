import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyVersion,
  ensureLauncher,
  launcherPath,
  readRuntimeRecord,
  recordedCopy,
  recordPath,
  registerCopy,
} from "../src/services/runtime-record.js";

let base: string;
let dir: string;
const logs: { code: string; data: Record<string, unknown> }[] = [];
const log = (code: string, data: Record<string, unknown>) => void logs.push({ code, data });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omms-runtime-record-"));
  dir = join(base, ".omms");
  logs.length = 0;
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

/** A package folder shaped like an installed OMMS copy. */
function makeCopy(name: string, version: string, launcher = `// launcher ${version}\n`): string {
  const root = join(base, name);
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "om-memory-system", version }));
  writeFileSync(join(root, "dist", "cli", "index.js"), "");
  writeFileSync(join(root, "bin", "omms-launch.mjs"), launcher);
  return root;
}

describe("copyVersion", () => {
  it("returns the version of a valid copy", () => {
    expect(copyVersion(makeCopy("a", "4.3.2"))).toBe("4.3.2");
  });

  it("rejects a folder with another package name", () => {
    const root = makeCopy("a", "4.3.2");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "other", version: "4.3.2" }));
    expect(copyVersion(root)).toBeNull();
  });

  it("rejects a copy without dist/cli/index.js", () => {
    const root = makeCopy("a", "4.3.2");
    rmSync(join(root, "dist"), { recursive: true });
    expect(copyVersion(root)).toBeNull();
  });

  it("rejects a version that cannot be compared", () => {
    expect(copyVersion(makeCopy("a", "unknown"))).toBeNull();
  });

  it("rejects a missing folder", () => {
    expect(copyVersion(join(base, "gone"))).toBeNull();
  });
});

describe("registerCopy", () => {
  it("writes the record when it is missing", () => {
    const root = makeCopy("a", "4.3.2");
    expect(registerCopy({ dir, root, log })).toBe("written");
    const record = readRuntimeRecord(dir, log);
    expect(record?.root).toBe(root);
    expect(record?.version).toBe("4.3.2");
    expect(typeof record?.updatedAt).toBe("string");
  });

  it("writes when the own copy is newer", () => {
    const old = makeCopy("old", "4.3.0");
    const fresh = makeCopy("new", "4.3.2");
    registerCopy({ dir, root: old, log });
    expect(registerCopy({ dir, root: fresh, log })).toBe("written");
    expect(readRuntimeRecord(dir, log)?.root).toBe(fresh);
  });

  it("keeps the record when the own copy is older", () => {
    const fresh = makeCopy("new", "4.3.2");
    const old = makeCopy("old", "4.3.0");
    registerCopy({ dir, root: fresh, log });
    expect(registerCopy({ dir, root: old, log })).toBe("kept");
    expect(readRuntimeRecord(dir, log)?.root).toBe(fresh);
  });

  it("keeps the record on a version tie", () => {
    const first = makeCopy("first", "4.3.2");
    const second = makeCopy("second", "4.3.2");
    registerCopy({ dir, root: first, log });
    expect(registerCopy({ dir, root: second, log })).toBe("kept");
    expect(readRuntimeRecord(dir, log)?.root).toBe(first);
  });

  it("replaces a record whose copy is gone, even with an older version", () => {
    const gone = makeCopy("gone", "4.4.0");
    registerCopy({ dir, root: gone, log });
    rmSync(gone, { recursive: true });
    const own = makeCopy("own", "4.3.0");
    expect(registerCopy({ dir, root: own, log })).toBe("written");
    expect(readRuntimeRecord(dir, log)?.root).toBe(own);
  });

  it("does not record a copy with a version that cannot be compared", () => {
    const root = makeCopy("a", "unknown");
    expect(registerCopy({ dir, root, log })).toBe("skipped");
    expect(existsSync(recordPath(dir))).toBe(false);
  });

  it("leaves no temporary file behind", () => {
    registerCopy({ dir, root: makeCopy("a", "4.3.2"), log });
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(join(dir, "bin")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("makes the record private to the user", () => {
    if (process.platform === "win32") return;
    registerCopy({ dir, root: makeCopy("a", "4.3.2"), log });
    expect(statSync(recordPath(dir)).mode & 0o777).toBe(0o600);
  });

  it("logs a code and returns failed when the folder cannot be written", () => {
    const blocker = join(base, "blocker");
    writeFileSync(blocker, "a file, not a folder");
    const result = registerCopy({
      dir: join(blocker, "inside"),
      root: makeCopy("a", "4.3.2"),
      log,
    });
    expect(result).toBe("failed");
    expect(logs.map((entry) => entry.code)).toContain("runtime-record-write-failed");
  });
});

describe("readRuntimeRecord", () => {
  it("returns null without logging when the record does not exist", () => {
    expect(readRuntimeRecord(dir, log)).toBeNull();
    expect(logs).toEqual([]);
  });

  it("returns null and logs a code when the record is not JSON", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(recordPath(dir), "{not json");
    expect(readRuntimeRecord(dir, log)).toBeNull();
    expect(logs.map((entry) => entry.code)).toEqual(["runtime-record-read-failed"]);
  });

  it("returns null and logs a code when the record has the wrong shape", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(recordPath(dir), JSON.stringify({ root: 5 }));
    expect(readRuntimeRecord(dir, log)).toBeNull();
    expect(logs.map((entry) => entry.code)).toEqual(["runtime-record-read-failed"]);
  });

  it("never writes the folder path or file text into a log entry", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(recordPath(dir), "secret-looking text {");
    readRuntimeRecord(dir, log);
    expect(JSON.stringify(logs)).not.toContain("secret-looking");
    expect(JSON.stringify(logs)).not.toContain(base);
  });
});

describe("recordedCopy", () => {
  it("returns the copy the record names, with its live version", () => {
    const root = makeCopy("a", "4.3.2");
    registerCopy({ dir, root, log });
    expect(recordedCopy(dir, log)).toEqual({ root, version: "4.3.2" });
  });

  it("returns null when the named copy is gone", () => {
    const root = makeCopy("a", "4.3.2");
    registerCopy({ dir, root, log });
    rmSync(root, { recursive: true });
    expect(recordedCopy(dir, log)).toBeNull();
  });

  it("returns null without a record", () => {
    expect(recordedCopy(dir, log)).toBeNull();
  });
});

describe("launcher placement", () => {
  it("copies the launcher of the copy that writes the record", () => {
    registerCopy({ dir, root: makeCopy("a", "4.3.2", "// from a\n"), log });
    expect(readFileSync(launcherPath(dir), "utf8")).toBe("// from a\n");
  });

  it("replaces the launcher when a newer copy writes the record", () => {
    registerCopy({ dir, root: makeCopy("a", "4.3.2", "// from a\n"), log });
    registerCopy({ dir, root: makeCopy("b", "4.4.0", "// from b\n"), log });
    expect(readFileSync(launcherPath(dir), "utf8")).toBe("// from b\n");
  });

  it("never lets an older copy replace the launcher", () => {
    registerCopy({ dir, root: makeCopy("new", "4.4.0", "// from new\n"), log });
    registerCopy({ dir, root: makeCopy("old", "4.3.0", "// from old\n"), log });
    expect(readFileSync(launcherPath(dir), "utf8")).toBe("// from new\n");
  });

  it("restores a missing launcher when the recorded copy starts again", () => {
    const root = makeCopy("a", "4.3.2", "// from a\n");
    registerCopy({ dir, root, log });
    rmSync(launcherPath(dir));
    expect(registerCopy({ dir, root, log })).toBe("kept");
    expect(readFileSync(launcherPath(dir), "utf8")).toBe("// from a\n");
  });

  it("repairs a launcher that differs from the recorded copy's launcher", () => {
    const root = makeCopy("a", "4.3.2", "// from a\n");
    registerCopy({ dir, root, log });
    writeFileSync(launcherPath(dir), "// damaged\n");
    registerCopy({ dir, root, log });
    expect(readFileSync(launcherPath(dir), "utf8")).toBe("// from a\n");
  });

  it("still writes the record when the copy has no launcher file", () => {
    const root = makeCopy("a", "4.3.2");
    rmSync(join(root, "bin"), { recursive: true });
    expect(registerCopy({ dir, root, log })).toBe("written");
    expect(existsSync(launcherPath(dir))).toBe(false);
  });
});

describe("ensureLauncher", () => {
  it("places the launcher from the first source that has one", () => {
    const bare = makeCopy("bare", "4.3.0");
    rmSync(join(bare, "bin"), { recursive: true });
    const withLauncher = makeCopy("with", "4.3.2", "// from with\n");
    expect(ensureLauncher({ dir, sources: [bare, null, withLauncher], log })).toBe(true);
    expect(readFileSync(launcherPath(dir), "utf8")).toBe("// from with\n");
  });

  it("leaves an existing launcher alone", () => {
    registerCopy({ dir, root: makeCopy("new", "4.4.0", "// from new\n"), log });
    expect(ensureLauncher({ dir, sources: [makeCopy("old", "4.3.0", "// from old\n")], log })).toBe(
      true
    );
    expect(readFileSync(launcherPath(dir), "utf8")).toBe("// from new\n");
  });

  it("returns false when no source has a launcher", () => {
    const bare = makeCopy("bare", "4.3.0");
    rmSync(join(bare, "bin"), { recursive: true });
    expect(ensureLauncher({ dir, sources: [bare, "/does/not/exist"], log })).toBe(false);
    expect(existsSync(launcherPath(dir))).toBe(false);
  });
});
