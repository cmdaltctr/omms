import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { launcherPath, registerCopy } from "../src/services/runtime-record.js";
import {
  installWebAutostart,
  preferredPackageRoot,
  removeWebAutostart,
  resolveWebRuntime,
  restartWebAutostart,
  webAutostartStatus,
} from "../src/services/web-autostart.js";

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A package folder shaped like an installed OMMS copy, with a launcher. */
function copy(base: string, name: string, version: string, launcher = true) {
  const root = join(base, name);
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  writeFileSync(join(root, "dist", "cli", "index.js"), "");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "om-memory-system", version }));
  if (launcher) {
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", "omms-launch.mjs"), `// launcher ${version}\n`);
  }
  return root;
}

/** A fresh package folder for a test that installs a login item. */
function pkg(version = "4.3.2"): string {
  const base = mkdtempSync(join(tmpdir(), "omms-login-pkg-"));
  homes.push(base);
  return copy(base, "omms", version);
}

for (const platform of ["darwin", "linux", "win32"] as const) {
  it(`writes and rewrites only OMMS's ${platform} login item`, () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-item-"));
    homes.push(home);
    const commands: string[] = [];
    const options = {
      home,
      platform,
      runtime: "/opt/node",
      packageRoot: pkg(),
      systemctlAvailable: true,
      run: (command: string, args: string[]) => commands.push([command, ...args].join(" ")),
    };
    const installed = installWebAutostart({ ...options, start: false });
    expect(installed.state).toBe("installed");
    const first = readFileSync(installed.path!, "utf8");
    expect(first).toContain("/opt/node");
    expect(first).toContain(launcherPath(join(home, ".omms")));
    expect(first).toContain("--login-item");
    expect(first).not.toContain(join("dist", "cli", "index.js"));
    expect(webAutostartStatus(options).state).toBe("installed");
    if (platform === "linux") {
      installWebAutostart(options);
      expect(commands.filter((line) => line.includes("daemon-reload"))).toHaveLength(1);
    }
    expect(webAutostartStatus({ ...options, runtime: "/new/node" }).command).toContain("/opt/node");
    installWebAutostart({ ...options, runtime: "/new/node", start: false });
    expect(readFileSync(installed.path!, "utf8")).toContain("/new/node");
    const foreign = join(home, "foreign-login-item");
    writeFileSync(foreign, "keep");
    removeWebAutostart(options);
    expect(existsSync(installed.path!)).toBe(false);
    expect(readFileSync(foreign, "utf8")).toBe("keep");
    if (platform === "linux") expect(commands.some((line) => line.includes("enable"))).toBe(true);
  });
}

it("removes an owned Linux item after systemctl becomes unavailable", () => {
  const home = mkdtempSync(join(tmpdir(), "omms-no-systemctl-"));
  homes.push(home);
  const options = {
    home,
    platform: "linux",
    runtime: "/opt/node",
    packageRoot: pkg(),
    systemctlAvailable: true,
    run: () => {},
  };
  const installed = installWebAutostart(options);
  expect(installed.state).toBe("installed");
  expect(
    removeWebAutostart({
      ...options,
      systemctlAvailable: false,
      run: () => {
        throw new Error("systemctl is unavailable");
      },
    }).state
  ).toBe("not-installed");
  expect(existsSync(installed.path!)).toBe(false);
});

it("leaves a foreign file at the fixed name untouched", () => {
  const home = mkdtempSync(join(tmpdir(), "omms-foreign-item-"));
  homes.push(home);
  const path = join(home, "Library", "LaunchAgents", "io.github.cmdaltctr.omms.web.plist");
  mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(path, "someone else's item");
  const options = {
    home,
    platform: "darwin" as const,
    runtime: "/opt/node",
    packageRoot: pkg(),
  };
  expect(() => installWebAutostart({ ...options, start: false })).toThrow("not owned");
  expect(() => removeWebAutostart(options)).toThrow("not owned");
  expect(readFileSync(path, "utf8")).toBe("someone else's item");
});

it("reports missing runtime or unsupported platform without writing files", () => {
  const home = mkdtempSync(join(tmpdir(), "omms-no-runtime-"));
  homes.push(home);
  expect(
    webAutostartStatus({ home, platform: "darwin", runtime: null, packageRoot: pkg() }).state
  ).toBe("no-runtime");
  expect(
    webAutostartStatus({
      home,
      platform: "freebsd",
      runtime: "/opt/node",
      packageRoot: pkg(),
    }).state
  ).toBe("unsupported");
  expect(
    webAutostartStatus({
      home,
      platform: "linux",
      runtime: "/opt/node",
      packageRoot: pkg(),
      systemctlAvailable: false,
    }).state
  ).toBe("unsupported");
});

it("stops a stalled login service command", () => {
  const home = mkdtempSync(join(tmpdir(), "omms-stalled-service-"));
  homes.push(home);
  const bin = join(home, "bin");
  mkdirSync(bin);
  const command = join(bin, "systemctl");
  writeFileSync(command, "#!/bin/sh\nsleep 8\n");
  chmodSync(command, 0o755);
  const originalPath = process.env.PATH;
  const started = Date.now();
  try {
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    expect(() =>
      installWebAutostart({
        home,
        platform: "linux",
        runtime: "/opt/node",
        packageRoot: pkg(),
        systemctlAvailable: true,
      })
    ).toThrow();
    expect(Date.now() - started).toBeLessThan(7_000);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
}, 12_000);

it("uses Node or Bun rather than OpenCode's executable", () => {
  expect(resolveWebRuntime("/opt/bin/node")).toBe("/opt/bin/node");
  expect(resolveWebRuntime("/opt/bin/bun")).toBe("/opt/bin/bun");
  const fallback = resolveWebRuntime("/opt/bin/opencode");
  expect(fallback).not.toBe("/opt/bin/opencode");
  expect(fallback).toMatch(/[\\/](node|bun)(\.exe)?$/i);
});

it("replaces a versioned Homebrew Cellar path with its stable link", () => {
  const prefix = mkdtempSync(join(tmpdir(), "omms-brew-"));
  homes.push(prefix);
  const cellar = join(prefix, "Cellar", "node", "26.9.0", "bin");
  mkdirSync(cellar, { recursive: true });
  const node = join(cellar, "node");
  writeFileSync(node, "");
  chmodSync(node, 0o755);
  // Unlinked or keg-only formula: only the opt link exists.
  mkdirSync(join(prefix, "opt"), { recursive: true });
  symlinkSync(join(prefix, "Cellar", "node", "26.9.0"), join(prefix, "opt", "node"));
  expect(resolveWebRuntime(node, "darwin")).toBe(join(prefix, "opt", "node", "bin", "node"));
  // Linked formula: prefer the familiar bin link.
  mkdirSync(join(prefix, "bin"));
  symlinkSync(node, join(prefix, "bin", "node"));
  expect(resolveWebRuntime(node, "darwin")).toBe(join(prefix, "bin", "node"));
  // No link at all: keep the path that works today.
  const other = join(prefix, "Cellar", "bun", "1.3.0", "bin", "bun");
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(other, "");
  expect(resolveWebRuntime(other, "darwin")).toBe(other);
});

describe("restartWebAutostart", () => {
  it("restarts the macOS login item with launchctl kickstart -k", () => {
    const commands: string[] = [];
    const restarted = restartWebAutostart({
      home: "/home/test",
      platform: "darwin",
      run: (command, args) => commands.push([command, ...args].join(" ")),
    });
    expect(restarted).toBe(true);
    expect(commands).toEqual([
      `launchctl kickstart -k gui/${process.getuid?.() ?? 0}/io.github.cmdaltctr.omms.web`,
    ]);
  });

  it("restarts the Linux login item through the user service manager", () => {
    const commands: string[] = [];
    const restarted = restartWebAutostart({
      home: "/home/test",
      platform: "linux",
      run: (command, args) => commands.push([command, ...args].join(" ")),
    });
    expect(restarted).toBe(true);
    expect(commands).toEqual(["systemctl --user restart omms-web.service"]);
  });

  it("reports failure when the service manager command fails", () => {
    for (const platform of ["darwin", "linux"]) {
      const restarted = restartWebAutostart({
        home: "/home/test",
        platform,
        run: () => {
          throw new Error("service not loaded");
        },
      });
      expect(restarted).toBe(false);
    }
  });

  it("has no service manager command on Windows", () => {
    const commands: string[] = [];
    const restarted = restartWebAutostart({
      home: "C:\\Users\\test",
      platform: "win32",
      run: (command) => commands.push(command),
    });
    expect(restarted).toBe(false);
    expect(commands).toEqual([]);
  });
});

describe("preferredPackageRoot", () => {
  it("keeps the newer global install when a host starts OMMS from an older cached copy", () => {
    const base = mkdtempSync(join(tmpdir(), "omms-login-root-"));
    homes.push(base);
    const cached = copy(base, "opencode-cache", "3.6.2");
    const global = copy(base, "global", "4.2.0");
    expect(preferredPackageRoot([cached, global, null])).toBe(global);
    expect(preferredPackageRoot([global, cached])).toBe(global);
  });

  it("ignores folders that are not an OMMS package with a built CLI", () => {
    const base = mkdtempSync(join(tmpdir(), "omms-login-root-"));
    homes.push(base);
    const own = copy(base, "own", "4.1.0");
    mkdirSync(join(base, "empty"));
    expect(preferredPackageRoot([join(base, "empty"), own, "/does/not/exist"])).toBe(own);
    expect(preferredPackageRoot([join(base, "empty")])).toBeNull();
  });

  it("ignores unparseable versions before and after a valid candidate", () => {
    const base = mkdtempSync(join(tmpdir(), "omms-login-root-"));
    homes.push(base);
    const invalid = copy(base, "invalid", "unknown");
    const valid = copy(base, "valid", "4.2.0");
    expect(preferredPackageRoot([invalid, valid])).toBe(valid);
    expect(preferredPackageRoot([valid, invalid])).toBe(valid);
    expect(preferredPackageRoot([invalid])).toBeNull();
  });
});

describe("login item runs the launcher", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    it(`runs ~/.omms/bin/omms-launch.mjs web --login-item on ${platform}`, () => {
      const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-"));
      homes.push(home);
      const status = installWebAutostart({
        home,
        platform,
        runtime: "/x/bin/node",
        packageRoot: pkg(),
        systemctlAvailable: true,
        run: () => {},
      });
      const launcher = launcherPath(join(home, ".omms"));
      expect(status.state).toBe("installed");
      expect(readFileSync(status.path!, "utf8")).toContain(launcher);
      expect(readFileSync(status.path!, "utf8")).toContain("--login-item");
      expect(readFileSync(status.path!, "utf8")).not.toContain("index.js");
    });
  }

  it("creates the launcher before it writes the item", () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-"));
    homes.push(home);
    const launcher = launcherPath(join(home, ".omms"));
    expect(existsSync(launcher)).toBe(false);
    installWebAutostart({
      home,
      platform: "darwin",
      runtime: "/x/bin/node",
      packageRoot: pkg("4.3.2"),
      start: false,
    });
    expect(readFileSync(launcher, "utf8")).toBe("// launcher 4.3.2\n");
  });

  it("rewrites an item from older OMMS that runs dist/cli/index.js directly", () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-"));
    homes.push(home);
    const options = {
      home,
      platform: "darwin" as const,
      runtime: "/x/bin/node",
      packageRoot: pkg(),
      start: false,
    };
    const path = installWebAutostart(options).path!;
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        launcherPath(join(home, ".omms")),
        "/opt/homebrew/lib/node_modules/om-memory-system/dist/cli/index.js"
      )
    );
    expect(readFileSync(path, "utf8")).toContain("om-memory-system/dist/cli/index.js");
    installWebAutostart(options);
    expect(readFileSync(path, "utf8")).toContain(launcherPath(join(home, ".omms")));
    expect(readFileSync(path, "utf8")).not.toContain("om-memory-system/dist/cli/index.js");
  });

  it("never replaces a launcher from a newer copy with an older copy's launcher", () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-"));
    homes.push(home);
    registerCopy({ dir: join(home, ".omms"), root: pkg("4.4.0") });
    installWebAutostart({
      home,
      platform: "darwin",
      runtime: "/x/bin/node",
      packageRoot: pkg("4.2.0"),
      start: false,
    });
    expect(readFileSync(launcherPath(join(home, ".omms")), "utf8")).toBe("// launcher 4.4.0\n");
  });

  it("takes the launcher from another copy when the chosen copy has none", () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-"));
    homes.push(home);
    const base = mkdtempSync(join(tmpdir(), "omms-login-pkg-"));
    homes.push(base);
    const old = copy(base, "global", "4.3.0", false);
    const own = copy(base, "own", "4.3.2");
    registerCopy({ dir: join(home, ".omms"), root: old });
    rmSync(launcherPath(join(home, ".omms")), { force: true });
    const status = installWebAutostart({
      home,
      platform: "darwin",
      runtime: "/x/bin/node",
      packageRoot: old,
      ownRoot: own,
      start: false,
    });
    expect(status.state).toBe("installed");
    expect(readFileSync(launcherPath(join(home, ".omms")), "utf8")).toBe("// launcher 4.3.2\n");
  });

  it("reports no-package and writes no item when no copy has a launcher", () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-"));
    homes.push(home);
    const base = mkdtempSync(join(tmpdir(), "omms-login-pkg-"));
    homes.push(base);
    const status = installWebAutostart({
      home,
      platform: "darwin",
      runtime: "/x/bin/node",
      packageRoot: copy(base, "bare", "4.3.0", false),
      ownRoot: null,
      start: false,
    });
    expect(status.state).toBe("no-package");
    expect(existsSync(status.path!)).toBe(false);
  });

  it("escapes the launcher path in a macOS item", () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-&-"));
    homes.push(home);
    const status = installWebAutostart({
      home,
      platform: "darwin",
      runtime: "/x/bin/node",
      packageRoot: pkg(),
      start: false,
    });
    expect(readFileSync(status.path!, "utf8")).toContain("launcher-&amp;-");
  });

  it("reports the copy the launcher starts: the newest of the record, the global install, and this copy", () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-"));
    homes.push(home);
    const base = mkdtempSync(join(tmpdir(), "omms-login-pkg-"));
    homes.push(base);
    const global = copy(join(base, "prefix", "lib", "node_modules"), "om-memory-system", "4.3.0");
    const recorded = copy(base, "pi", "4.3.2");
    const own = copy(base, "own", "4.3.1");
    registerCopy({ dir: join(home, ".omms"), root: recorded });
    const status = installWebAutostart({
      home,
      platform: "darwin",
      runtime: join(base, "prefix", "bin", "node"),
      ownRoot: own,
      start: false,
    });
    expect(status.packagePath).toBe(recorded);
    expect(status.launcher).toBe(launcherPath(join(home, ".omms")));
    expect(global).toContain("om-memory-system");
  });

  it("falls back to the global install when the recorded copy is gone", () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-launcher-"));
    homes.push(home);
    const base = mkdtempSync(join(tmpdir(), "omms-login-pkg-"));
    homes.push(base);
    const global = copy(join(base, "prefix", "lib", "node_modules"), "om-memory-system", "4.3.0");
    const gone = copy(base, "cache", "4.3.2");
    registerCopy({ dir: join(home, ".omms"), root: gone });
    rmSync(gone, { recursive: true });
    const status = installWebAutostart({
      home,
      platform: "darwin",
      runtime: join(base, "prefix", "bin", "node"),
      ownRoot: copy(base, "own", "4.2.0"),
      start: false,
    });
    expect(status.packagePath).toBe(global);
  });
});
