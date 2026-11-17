import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { compareVersions } from "../src/services/version-compare.js";
import {
  chooseCopy,
  compareVersions as launcherCompare,
  findCandidates,
  globalPackageRoot,
  globalPackageRoots,
  parseLauncherArgs,
  runLauncher,
} from "../bin/omms-launch.mjs";
import { registerCopy } from "../src/services/runtime-record.js";

const LAUNCHER = join(import.meta.dir, "../bin/omms-launch.mjs");

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omms-launch-"));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/**
 * A fake OMMS copy. Its `dist/cli/index.js` prints its version, its arguments,
 * and standard input as JSON, then exits with the code in `FAKE_EXIT`.
 */
function makeCopy(name: string, version: string): string {
  const root = join(base, name);
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "om-memory-system", version }));
  writeFileSync(
    join(root, "dist", "cli", "index.js"),
    `let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ version: ${JSON.stringify(version)}, args: process.argv.slice(2), input }));
  process.exit(Number(process.env.FAKE_EXIT ?? 0));
});
`
  );
  return root;
}

describe("launcher SemVer compare", () => {
  const versions = [
    "4.3.0",
    "4.3.2",
    "4.3.10",
    "4.10.0",
    "5.0.0",
    "4.3.2-beta.1",
    "4.3.2-beta.2",
    "4.3.2-beta.10",
    "4.3.2-alpha",
    "4.3.2-1",
    "4.3.2-rc.1+build5",
    "unknown",
    "4.3",
    "",
  ];

  it("agrees with compareVersions over a shared list that includes prereleases", () => {
    for (const a of versions)
      for (const b of versions) {
        expect([a, b, launcherCompare(a, b)]).toEqual([a, b, compareVersions(a, b)]);
      }
  });
});

describe("chooseCopy", () => {
  const copy = (root: string, version: string) => ({ root, version });

  it("picks the newest valid candidate", () => {
    const choice = chooseCopy([copy("/a", "4.3.0"), copy("/b", "4.3.2"), copy("/c", "4.3.1")]);
    expect(choice).toEqual({ kind: "copy", copy: copy("/b", "4.3.2") });
  });

  it("skips null candidates", () => {
    expect(chooseCopy([null, copy("/a", "4.3.0"), null])).toEqual({
      kind: "copy",
      copy: copy("/a", "4.3.0"),
    });
  });

  it("keeps the first candidate on a tie", () => {
    expect(chooseCopy([copy("/record", "4.3.2"), copy("/global", "4.3.2")])).toEqual({
      kind: "copy",
      copy: copy("/record", "4.3.2"),
    });
  });

  it("returns none when no candidate exists and no minimum is set", () => {
    expect(chooseCopy([null, null])).toEqual({ kind: "none" });
  });

  it("accepts the newest candidate when it reaches the minimum", () => {
    expect(chooseCopy([copy("/a", "4.3.3")], "4.3.3")).toEqual({
      kind: "copy",
      copy: copy("/a", "4.3.3"),
    });
  });

  it("chooses npx only when no candidate reaches the minimum", () => {
    expect(chooseCopy([copy("/a", "4.3.0")], "4.3.3")).toEqual({ kind: "npx", version: "4.3.3" });
    expect(chooseCopy([], "4.3.3")).toEqual({ kind: "npx", version: "4.3.3" });
  });

  it("treats an unparsable minimum as no minimum", () => {
    expect(chooseCopy([copy("/a", "4.3.0")], "unknown")).toEqual({
      kind: "copy",
      copy: copy("/a", "4.3.0"),
    });
  });
});

describe("findCandidates", () => {
  it("skips a record that names a missing copy and keeps the global install", () => {
    const home = join(base, ".omms");
    const gone = makeCopy("gone", "4.3.2");
    registerCopy({ dir: home, root: gone });
    rmSync(gone, { recursive: true });
    const prefix = join(base, "prefix");
    const execPath = join(prefix, "bin", "node");
    // The folder `findCandidates` checks differs by platform; the layouts have their own test.
    const global = globalPackageRoot(execPath)!;
    mkdirSync(join(global, "dist", "cli"), { recursive: true });
    writeFileSync(
      join(global, "package.json"),
      JSON.stringify({ name: "om-memory-system", version: "4.3.0" })
    );
    writeFileSync(join(global, "dist", "cli", "index.js"), "");
    const found = findCandidates({ dir: home, execPath, ownRoot: join(base, "no-dist") });
    expect(found.filter(Boolean)).toEqual([{ root: global, version: "4.3.0" }]);
  });

  it("lists the global install, the record, and the own root in that order", () => {
    const home = join(base, ".omms");
    const recorded = makeCopy("recorded", "4.3.2");
    registerCopy({ dir: home, root: recorded });
    const own = makeCopy("own", "4.3.3");
    const found = findCandidates({
      dir: home,
      execPath: join(base, "x", "bin", "node"),
      ownRoot: own,
    });
    expect(found).toEqual([
      null,
      { root: recorded, version: "4.3.2" },
      { root: own, version: "4.3.3" },
    ]);
  });

  it("runs the global install over a recorded host cache copy of the same version", () => {
    // A host's cache copy in runtime.json kept serving after `npm i -g` caught up.
    const home = join(base, ".omms");
    const recorded = makeCopy("recorded", "4.3.2");
    registerCopy({ dir: home, root: recorded });
    const execPath = join(base, "prefix", "bin", "node");
    const global = globalPackageRoot(execPath)!;
    mkdirSync(join(global, "dist", "cli"), { recursive: true });
    writeFileSync(
      join(global, "package.json"),
      JSON.stringify({ name: "om-memory-system", version: "4.3.2" })
    );
    writeFileSync(join(global, "dist", "cli", "index.js"), "");
    const choice = chooseCopy(findCandidates({ dir: home, execPath, ownRoot: null }));
    expect(choice).toEqual({ kind: "copy", copy: { root: global, version: "4.3.2" } });
  });

  it("finds a Homebrew global install above the versioned Cellar folder", () => {
    // Homebrew runs Node from Cellar/node/<version>, but npm installs under the prefix.
    const prefix = join(base, "brew");
    const global = join(prefix, "lib", "node_modules", "om-memory-system");
    mkdirSync(join(global, "dist", "cli"), { recursive: true });
    writeFileSync(
      join(global, "package.json"),
      JSON.stringify({ name: "om-memory-system", version: "4.3.3" })
    );
    writeFileSync(join(global, "dist", "cli", "index.js"), "");
    const execPath = join(prefix, "Cellar", "node", "26.9.0", "bin", "node");
    expect(globalPackageRoots(execPath, "darwin")).toContain(global);
    const found = findCandidates({
      dir: join(base, ".omms"),
      execPath,
      ownRoot: join(base, "no-dist"),
    });
    expect(found.filter(Boolean)).toEqual([{ root: global, version: "4.3.3" }]);
  });

  it("uses the Windows global layout beside node.exe", () => {
    expect(globalPackageRoot("C:\\node\\node.exe", "win32")).toMatch(
      /node_modules[\\/]om-memory-system$/
    );
    expect(globalPackageRoot("/opt/homebrew/bin/node", "darwin")).toBe(
      join("/opt/homebrew", "lib", "node_modules", "om-memory-system")
    );
    expect(globalPackageRoot("", "darwin")).toBeNull();
  });
});

describe("parseLauncherArgs", () => {
  it("strips a leading --at-least-own-version flag", () => {
    expect(parseLauncherArgs(["--at-least-own-version", "claude-hook", "session-start"])).toEqual({
      atLeastOwnVersion: true,
      args: ["claude-hook", "session-start"],
    });
  });

  it("passes every other argument through untouched", () => {
    expect(parseLauncherArgs(["web", "--login-item"])).toEqual({
      atLeastOwnVersion: false,
      args: ["web", "--login-item"],
    });
    expect(parseLauncherArgs(["memory", "--at-least-own-version"])).toEqual({
      atLeastOwnVersion: false,
      args: ["memory", "--at-least-own-version"],
    });
  });
});

describe("launcher process", () => {
  /** A copy of the launcher with no package.json or dist/ beside it, so the repo is not a candidate. */
  function isolatedLauncher(): string {
    const folder = join(base, "isolated", "bin");
    mkdirSync(folder, { recursive: true });
    const file = join(folder, "omms-launch.mjs");
    writeFileSync(file, readLauncher());
    return file;
  }

  function run(
    home: string,
    args: string[],
    options: { input?: string; env?: Record<string, string> } = {}
  ) {
    // HOME points the launcher at a temp record; PATH has no global install.
    return spawnSync(process.execPath, [isolatedLauncher(), ...args], {
      input: options.input,
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, ...options.env },
    });
  }

  it("runs the newest recorded copy with arguments, standard input, and exit code", () => {
    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    const recorded = makeCopy("recorded", "4.3.2");
    registerCopy({ dir: join(home, ".omms"), root: recorded });
    const result = run(home, ["memory", "search", "database choice"], {
      input: '{"hook":"input"}',
      env: { FAKE_EXIT: "3" },
    });
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual({
      version: "4.3.2",
      args: ["memory", "search", "database choice"],
      input: '{"hook":"input"}',
    });
  });

  it("exits 1 with a short message when no copy exists", () => {
    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    const result = run(home, ["web"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no OMMS copy");
  });

  it("falls back to npx at the launcher's own version when every copy is older (7.2)", () => {
    // A plugin folder: the launcher, a package.json at version 9.9.9, and no dist/.
    const plugin = join(base, "plugin");
    mkdirSync(join(plugin, "bin"), { recursive: true });
    writeFileSync(
      join(plugin, "package.json"),
      JSON.stringify({ name: "om-memory-system", version: "9.9.9" })
    );
    const launcher = join(plugin, "bin", "omms-launch.mjs");
    writeFileSync(launcher, readLauncher());
    // A recorded copy that is older than the plugin.
    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    registerCopy({ dir: join(home, ".omms"), root: makeCopy("older", "4.3.0") });
    // A fake npx that records its arguments and the folder it runs in.
    const bin = join(base, "fakebin");
    mkdirSync(bin, { recursive: true });
    // On Windows the launcher runs `npx.cmd` through a shell, so the fake is a batch file.
    const windows = process.platform === "win32";
    if (windows) {
      writeFileSync(
        join(bin, "npx.cmd"),
        "@echo off\r\nfor %%a in (%*) do echo %%a\r\necho cwd:%CD%\r\n"
      );
    } else {
      const npx = join(bin, "npx");
      writeFileSync(npx, '#!/bin/sh\nprintf "%s\\n" "$@"\necho "cwd:$(pwd -P)"\n');
      chmodSync(npx, 0o755);
    }
    // Windows names the variable `Path`; a second `PATH` key would be ambiguous there.
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    const result = spawnSync(
      process.execPath,
      [launcher, "--at-least-own-version", "claude-hook", "session-start"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          [pathKey]: `${bin}${delimiter}${process.env[pathKey] ?? ""}`,
        },
      }
    );
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      "--yes",
      "om-memory-system@9.9.9",
      "claude-hook",
      "session-start",
      // Not the caller's folder: a project named om-memory-system would otherwise win over npm.
      `cwd:${realpathSync(tmpdir())}`,
    ]);
  });
});

function readLauncher(): string {
  return readFileSync(LAUNCHER, "utf8");
}

describe("importing the launcher", () => {
  it("does not throw when process.argv[1] names a path that does not exist", () => {
    // A loader or wrapper can leave argv[1] pointing at a file that is not there.
    // The direct-run check must treat that as "not run directly", and start nothing.
    const script = join(base, "import-with-bad-argv.mjs");
    writeFileSync(
      script,
      `process.argv[1] = ${JSON.stringify(join(base, "no", "such", "entry.js"))};
try {
  await import(${JSON.stringify(pathToFileURL(LAUNCHER).href)});
  console.log("import ok");
} catch (error) {
  console.log("import threw: " + (error.code ?? error.name));
}
`
    );
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.stdout.trim()).toBe("import ok");
    // Nothing started: the launcher printed no "no OMMS copy" message either.
    expect(result.stderr).toBe("");
  });
});

describe("runLauncher", () => {
  it("returns the child's exit code through the injected spawn", async () => {
    const root = makeCopy("a", "4.3.2");
    const seen: { command: string; args: string[] }[] = [];
    const code = await runLauncher(["web"], {
      dir: join(base, ".omms"),
      execPath: process.execPath,
      ownRoot: root,
      spawn: async (command, args) => {
        seen.push({ command, args });
        return 7;
      },
    });
    expect(code).toBe(7);
    expect(seen).toEqual([
      { command: process.execPath, args: [join(root, "dist", "cli", "index.js"), "web"] },
    ]);
  });
});

describe("incomplete copies", () => {
  /** A global install beside a fake Node.js, as npm writes it, and that Node.js path. */
  function globalCopy(version: string): { root: string; execPath: string } {
    const execPath = join(base, "prefix", "bin", "node");
    const root = globalPackageRoot(execPath)!;
    mkdirSync(join(root, "dist", "cli"), { recursive: true });
    writeFileSync(join(root, "dist", "cli", "index.js"), "");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "om-memory-system",
        version,
        dependencies: { "@libsql/client": "^0.17" },
      })
    );
    mkdirSync(join(root, "node_modules", "@libsql", "client"), { recursive: true });
    writeFileSync(join(root, "node_modules", "@libsql", "client", "package.json"), "{}");
    return { root, execPath };
  }

  it("starts the next valid copy when the newest global copy has an empty folder (14 November)", async () => {
    const global = globalCopy("6.4.0");
    // `js-base64` is a dependency of `@libsql/hrana-client`, not of OMMS itself.
    mkdirSync(join(global.root, "node_modules", "js-base64"), { recursive: true });
    const home = join(base, ".omms");
    const pi = makeCopy("pi-cache", "6.3.0");
    registerCopy({ dir: home, root: pi });
    const seen: string[][] = [];
    const code = await runLauncher(["web", "--login-item"], {
      dir: home,
      execPath: global.execPath,
      ownRoot: join(base, "no-dist"),
      now: () => 0,
      log: () => {},
      spawn: async (_command, args) => {
        seen.push(args);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(seen).toEqual([[join(pi, "dist", "cli", "index.js"), "web", "--login-item"]]);
  });

  it("prints one line naming the missing dependency and exits 1 when no copy is valid", () => {
    const global = globalCopy("6.4.0");
    mkdirSync(join(global.root, "node_modules", "js-base64"), { recursive: true });
    const folder = join(base, "isolated", "bin");
    mkdirSync(folder, { recursive: true });
    const launcher = join(folder, "omms-launch.mjs");
    writeFileSync(launcher, readLauncher());
    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    // The launcher runs under the fake Node.js path, so its global install is the broken one.
    const script = join(base, "run-broken.mjs");
    writeFileSync(
      script,
      `const { runLauncher } = await import(${JSON.stringify(pathToFileURL(launcher).href)});
process.exitCode = await runLauncher(["memory"], { execPath: ${JSON.stringify(global.execPath)} });\n`
    );
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split(/\r?\n/)).toEqual([
      "omms-launch: no complete OMMS copy found (missing js-base64). Run: npx -p om-memory-system@latest om-memory-system web update",
    ]);
  });

  it("logs the missing dependency before it counts the failed login-item start", async () => {
    const global = globalCopy("6.4.0");
    mkdirSync(join(global.root, "node_modules", "js-base64"), { recursive: true });
    const home = join(base, ".omms");
    const logs: Record<string, unknown>[] = [];
    const code = await runLauncher(["web", "--login-item"], {
      dir: home,
      execPath: global.execPath,
      ownRoot: join(base, "no-dist"),
      now: () => 0,
      log: (data: Record<string, unknown>) => logs.push(data),
      spawn: async () => 0,
    });
    expect(code).toBe(1);
    // stderr goes to /dev/null under the login item, so the log is the only trace.
    expect(logs).toEqual([{ code: "no-valid-copy", missing: "js-base64" }]);
    expect(JSON.parse(readFileSync(join(home, "web-starts.json"), "utf8"))).toEqual([0]);
  });
});

describe("login item restart limit", () => {
  function login(config: { exit: number; now: number; args?: string[] }) {
    const home = join(base, ".omms");
    const root = makeCopy("a", "6.5.0");
    const logs: Record<string, unknown>[] = [];
    let spawned = 0;
    const run = runLauncher(config.args ?? ["web", "--login-item"], {
      dir: home,
      execPath: join(base, "x", "bin", "node"),
      ownRoot: root,
      now: () => config.now,
      log: (data: Record<string, unknown>) => logs.push(data),
      spawn: async () => {
        spawned++;
        return config.exit;
      },
    });
    return run.then((code) => ({ code, logs, spawned, starts: join(home, "web-starts.json") }));
  }
  const MINUTE = 60_000;

  it("stops after 5 failed starts within 10 minutes, logs restart-limit and exits 0", async () => {
    for (let i = 0; i < 5; i++) {
      const failed = await login({ exit: 1, now: i * MINUTE });
      expect([failed.code, failed.spawned, failed.logs]).toEqual([1, 1, []]);
    }
    const sixth = await login({ exit: 1, now: 5 * MINUTE });
    expect(sixth.code).toBe(0);
    expect(sixth.spawned).toBe(0);
    expect(sixth.logs).toEqual([{ code: "restart-limit", failures: 5 }]);
    // Nothing restarts an exit with 0, so the next login starts afresh.
    const nextLogin = await login({ exit: 0, now: 6 * MINUTE });
    expect([nextLogin.code, nextLogin.spawned]).toEqual([0, 1]);
  });

  it("forgets failures older than 10 minutes", async () => {
    for (let i = 0; i < 4; i++) await login({ exit: 1, now: 0 });
    await login({ exit: 1, now: 11 * MINUTE });
    const next = await login({ exit: 1, now: 11 * MINUTE });
    expect([next.spawned, next.logs]).toEqual([1, []]);
  });

  it("does not count a start that exits with 0 (Stop, hand-over, update restart)", async () => {
    for (let i = 0; i < 6; i++) await login({ exit: 0, now: 0 });
    for (let i = 0; i < 4; i++) await login({ exit: 1, now: 0 });
    const fifth = await login({ exit: 1, now: 0 });
    expect([fifth.spawned, fifth.logs]).toEqual([1, []]);
  });

  it("counts nothing outside the login item", async () => {
    for (let i = 0; i < 6; i++) {
      const plain = await login({ exit: 1, now: 0, args: ["web"] });
      expect([plain.spawned, plain.logs]).toEqual([1, []]);
      expect(existsSync(plain.starts)).toBe(false);
    }
  });
});
