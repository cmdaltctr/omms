import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findGlobalCommand,
  globalCommandVersion,
  globalRelation,
} from "../src/services/global-version.js";
import { packageVersion } from "../src/services/package-version.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("om-memory-system --version", () => {
  it("prints the package.json version and exits 0", () => {
    const expected = (
      JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    expect(packageVersion()).toBe(expected);
    for (const flag of ["--version", "-v"]) {
      const result = spawnSync("bun", ["run", join(import.meta.dir, "../src/cli/index.ts"), flag], {
        encoding: "utf8",
        // Print this copy's own version, even when a newer copy is recorded on this machine.
        env: { ...process.env, OMMS_NO_HANDOFF: "1" },
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(expected);
    }
  });
});

describe("global command version", () => {
  it("finds the command on PATH, including a Windows .cmd wrapper", () => {
    const seen: string[] = [];
    const exists = (path: string) => {
      seen.push(path);
      return path.startsWith("C:\\Users") && path.endsWith("om-memory-system.cmd");
    };
    expect(
      findGlobalCommand(
        { PATH: "C:\\Tools;C:\\Users\\me\\AppData\\Roaming\\npm\\" },
        "win32",
        exists
      )
    ).toBe("C:\\Users\\me\\AppData\\Roaming\\npm\\om-memory-system.cmd");
    expect(seen[0]).toBe("C:\\Tools\\om-memory-system.exe");
    expect(findGlobalCommand({ PATH: "relative:/usr/bin" }, "linux", () => false)).toBeNull();
  });

  /** An installed copy: `<prefix>/lib/node_modules/om-memory-system` and a `bin` link to its CLI. */
  function install(version: string | null) {
    const prefix = mkdtempSync(join(tmpdir(), "omms-global-"));
    dirs.push(prefix);
    const root = join(prefix, "lib", "node_modules", "om-memory-system");
    mkdirSync(join(root, "dist", "cli"), { recursive: true });
    mkdirSync(join(prefix, "bin"));
    const marker = join(prefix, "command-ran");
    const cli = join(root, "dist", "cli", "index.js");
    // If anything runs the command, this file appears.
    writeFileSync(cli, `#!/bin/sh\ntouch "${marker}"\necho 9.9.9\n`);
    chmodSync(cli, 0o755);
    if (version !== null)
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "om-memory-system", version })
      );
    const link = join(prefix, "bin", "om-memory-system");
    symlinkSync(
      join("..", "lib", "node_modules", "om-memory-system", "dist", "cli", "index.js"),
      link
    );
    return { prefix, root, link, marker };
  }

  it("reads the version from the install's package.json through the PATH symlink", () => {
    const { link } = install("4.3.0");
    expect(globalCommandVersion({ find: () => link })).toEqual({ version: "4.3.0", path: link });
  });

  it("does not run the command", () => {
    const { link, marker } = install("4.3.0");
    globalCommandVersion({ find: () => link });
    expect(existsSync(marker)).toBe(false);
  });

  it("reads the Windows layout beside the .cmd wrapper", () => {
    const prefix = mkdtempSync(join(tmpdir(), "omms-global-win-"));
    dirs.push(prefix);
    const root = join(prefix, "node_modules", "om-memory-system");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "om-memory-system", version: "4.2.1" })
    );
    const cmd = join(prefix, "om-memory-system.cmd");
    writeFileSync(cmd, "@echo off\r\n");
    expect(globalCommandVersion({ find: () => cmd, platform: "win32" })).toEqual({
      version: "4.2.1",
      path: cmd,
    });
  });

  it("reports a missing command", () => {
    expect(globalCommandVersion({ find: () => null })).toEqual({ version: null, path: null });
  });

  it("reports a failure when the package.json cannot be read", () => {
    const { link } = install(null);
    expect(globalCommandVersion({ find: () => link })).toEqual({
      version: null,
      path: link,
      error: "failed",
    });
  });

  it("reports a failure when the command is not an OMMS install", () => {
    const prefix = mkdtempSync(join(tmpdir(), "omms-global-other-"));
    dirs.push(prefix);
    const other = join(prefix, "om-memory-system");
    writeFileSync(other, "#!/bin/sh\n");
    expect(globalCommandVersion({ find: () => other })).toEqual({
      version: null,
      path: other,
      error: "failed",
    });
  });
});

describe("global install against the running version", () => {
  it("says the global install is older when the running copy is newer", () => {
    expect(globalRelation("4.3.2", "4.3.0")).toBe("older");
  });

  it("says the global install is newer than the running copy", () => {
    expect(globalRelation("4.3.0", "4.3.2")).toBe("newer");
  });

  it("says the versions are the same, or that there is no global install", () => {
    expect(globalRelation("4.3.2", "4.3.2")).toBe("same");
    expect(globalRelation("4.3.2", null)).toBe("missing");
  });

  it("says unknown when a version cannot be compared", () => {
    expect(globalRelation("unknown", "4.3.0")).toBe("unknown");
    expect(globalRelation("4.3.0", "unknown")).toBe("unknown");
  });
});
