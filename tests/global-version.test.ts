import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findGlobalCommand,
  globalCommandVersion,
  resetGlobalVersionCache,
  versionInvocation,
} from "../src/services/global-version.js";
import { packageVersion } from "../src/services/package-version.js";

afterEach(() => resetGlobalVersionCache());

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
    expect(
      versionInvocation("C:\\npm\\om-memory-system.cmd", "win32", { SystemRoot: "C:\\Windows" })
    ).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\npm\\om-memory-system.cmd" --version'],
    });
  });

  it("reports a found version and caches it for 10 minutes", async () => {
    let calls = 0;
    let now = 0;
    const options = {
      now: () => now,
      find: () => "/usr/local/bin/om-memory-system",
      runner: async (_file: string, args: string[], opts: { timeout: number; shell: false }) => {
        calls++;
        expect(args).toEqual(["--version"]);
        expect(opts).toMatchObject({ timeout: 3_000, shell: false });
        return "3.3.1\n";
      },
    };
    expect(await globalCommandVersion(options)).toEqual({
      version: "3.3.1",
      path: "/usr/local/bin/om-memory-system",
    });
    now = 9 * 60_000;
    await globalCommandVersion(options);
    expect(calls).toBe(1);
    now = 11 * 60_000;
    await globalCommandVersion(options);
    expect(calls).toBe(2);
  });

  it("reports a missing command and a timeout", async () => {
    expect(await globalCommandVersion({ find: () => null })).toEqual({ version: null, path: null });
    resetGlobalVersionCache();
    const timedOut = await globalCommandVersion({
      find: () => "/bin/om-memory-system",
      runner: async () => {
        throw Object.assign(new Error("timeout"), { killed: true, signal: "SIGTERM" });
      },
    });
    expect(timedOut).toEqual({ version: null, path: "/bin/om-memory-system", error: "timeout" });
  });
});
