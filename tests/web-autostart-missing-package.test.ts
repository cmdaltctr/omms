import { afterEach, expect, it, mock } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ownCli = join(import.meta.dir, "..", "dist", "cli", "index.js");
const existsSync = fs.existsSync;
const homes: string[] = [];

// Simulate an unbuilt checkout without removing the real build or login item.
mock.module("node:fs", () => ({
  ...fs,
  existsSync: (path: fs.PathLike) => String(path) !== ownCli && existsSync(path),
}));

const { installWebAutostart, itemPackageRoot } = await import("../src/services/web-autostart.js");

afterEach(() => {
  homes.splice(0).forEach((home) => fs.rmSync(home, { recursive: true, force: true }));
});

it("writes the preferred global root through installWebAutostart", () => {
  const home = fs.mkdtempSync(join(tmpdir(), "omms-global-package-"));
  homes.push(home);
  const global = join(home, "prefix", "lib", "node_modules", "om-memory-system");
  const cached = join(home, "cache");
  for (const [root, version] of [
    [global, "99.0.0"],
    [cached, "3.6.2"],
  ] as const) {
    fs.mkdirSync(join(root, "dist", "cli"), { recursive: true });
    fs.writeFileSync(join(root, "dist", "cli", "index.js"), "");
    fs.writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "om-memory-system", version })
    );
  }
  const options = {
    home,
    platform: "darwin" as const,
    runtime: join(home, "prefix", "bin", "node"),
    start: false,
  };
  installWebAutostart({ ...options, packageRoot: cached });
  const status = installWebAutostart(options);
  expect(status.state).toBe("installed");
  expect(itemPackageRoot(status.path!)).toBe(global);
});

it("reports no-package instead of installing a login item for a missing CLI", () => {
  const home = fs.mkdtempSync(join(tmpdir(), "omms-missing-package-"));
  homes.push(home);
  const status = installWebAutostart({
    home,
    platform: "darwin",
    runtime: join(home, "bin", "node"),
    start: false,
  });
  expect(status.state).toBe("no-package");
  expect(existsSync(status.path!)).toBe(false);
});
