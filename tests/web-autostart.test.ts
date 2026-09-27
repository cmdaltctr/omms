import { afterEach, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installWebAutostart,
  removeWebAutostart,
  resolveWebRuntime,
  webAutostartStatus,
} from "../src/services/web-autostart.js";

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

for (const platform of ["darwin", "linux", "win32"] as const) {
  it(`writes and rewrites only OMMS's ${platform} login item`, () => {
    const home = mkdtempSync(join(tmpdir(), "omms-login-item-"));
    homes.push(home);
    const commands: string[] = [];
    const options = {
      home,
      platform,
      runtime: "/opt/node",
      packageRoot: "/opt/omms",
      systemctlAvailable: true,
      run: (command: string, args: string[]) => commands.push([command, ...args].join(" ")),
    };
    const installed = installWebAutostart({ ...options, start: false });
    expect(installed.state).toBe("installed");
    const first = readFileSync(installed.path!, "utf8");
    expect(first).toContain("/opt/node");
    expect(first).toContain("/opt/omms/dist/cli/index.js");
    expect(first).toContain("web");
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
    packageRoot: "/opt/omms",
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
    packageRoot: "/opt/omms",
  };
  expect(() => installWebAutostart({ ...options, start: false })).toThrow("not owned");
  expect(() => removeWebAutostart(options)).toThrow("not owned");
  expect(readFileSync(path, "utf8")).toBe("someone else's item");
});

it("reports missing runtime or unsupported platform without writing files", () => {
  const home = mkdtempSync(join(tmpdir(), "omms-no-runtime-"));
  homes.push(home);
  expect(
    webAutostartStatus({ home, platform: "darwin", runtime: null, packageRoot: "/opt/omms" }).state
  ).toBe("no-runtime");
  expect(
    webAutostartStatus({
      home,
      platform: "freebsd",
      runtime: "/opt/node",
      packageRoot: "/opt/omms",
    }).state
  ).toBe("unsupported");
  expect(
    webAutostartStatus({
      home,
      platform: "linux",
      runtime: "/opt/node",
      packageRoot: "/opt/omms",
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
        packageRoot: "/opt/omms",
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
  expect(fallback).toMatch(/\/(node|bun)$/);
});
