import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostSetupDeps } from "../src/core/host-setup.js";
import { piPackageListed, piSetup } from "../src/adapters/pi/setup.js";

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "omms-pi-setup-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function deps(home: string, env: Record<string, string> = {}): HostSetupDeps {
  return {
    env,
    home,
    platform: "linux",
    program: join(home, "bin", "pi"),
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    run: () => {
      throw new Error("Pi setup must not run a command to read its state");
    },
  };
}

function writeSettings(folder: string, packages: unknown[]): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ packages }));
}

describe("piPackageListed", () => {
  it("accepts the package with or without a version, as a string or an object", () => {
    expect(piPackageListed(JSON.stringify({ packages: ["npm:om-memory-system"] }))).toBe(true);
    expect(piPackageListed(JSON.stringify({ packages: ["npm:om-memory-system@6.4.0"] }))).toBe(
      true
    );
    expect(
      piPackageListed(JSON.stringify({ packages: [{ source: "npm:om-memory-system@6.4.0" }] }))
    ).toBe(true);
  });

  it("rejects other packages, a missing file and broken text", () => {
    expect(piPackageListed(JSON.stringify({ packages: ["npm:om-memory-system-extra"] }))).toBe(
      false
    );
    expect(piPackageListed(JSON.stringify({ packages: "npm:om-memory-system" }))).toBe(false);
    expect(piPackageListed(null)).toBe(false);
    expect(piPackageListed("{ broken")).toBe(false);
  });
});

describe("piSetup", () => {
  it("reads settings.json under the home folder", () => {
    const home = scratch();
    expect(piSetup.registered(deps(home))).toBe(false);
    writeSettings(join(home, ".pi", "agent"), ["npm:om-memory-system@6.4.0"]);
    expect(piSetup.registered(deps(home))).toBe(true);
  });

  it("honours PI_CODING_AGENT_DIR", () => {
    const home = scratch();
    const piDir = join(home, "custom-pi");
    writeSettings(join(home, ".pi", "agent"), ["npm:om-memory-system"]);
    expect(piSetup.registered(deps(home, { PI_CODING_AGENT_DIR: piDir }))).toBe(false);
    writeSettings(piDir, ["npm:om-memory-system"]);
    expect(piSetup.registered(deps(home, { PI_CODING_AGENT_DIR: piDir }))).toBe(true);
  });

  it("installs through Pi's own command and says to restart Pi", () => {
    expect(piSetup.installSteps(deps(scratch()))).toEqual([
      expect.objectContaining({ command: "pi", args: ["install", "npm:om-memory-system"] }),
    ]);
    const step = piSetup.nextStep({
      id: "pi",
      version: "0.86.1",
      registered: true,
      changed: true,
      captureReady: true,
      settingsUrl: "http://127.0.0.1:4747/settings#settings-section-external-api",
    });
    expect(step).toContain("Restart Pi");
  });
});
