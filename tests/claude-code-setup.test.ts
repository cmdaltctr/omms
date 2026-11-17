import { describe, expect, it } from "bun:test";
import type { HostFacts, HostSetupDeps } from "../src/core/host-setup.js";
import { claudeCodeSetup } from "../src/adapters/claude-code/setup.js";

const SETTINGS_URL = "http://127.0.0.1:4747/settings#settings-section-external-api";

/** A fake `claude` that answers from a table and records each call. */
function deps(outputs: Record<string, { status?: number; stdout?: string }>) {
  const calls: string[] = [];
  const value: HostSetupDeps = {
    env: {},
    home: "/scratch/home",
    platform: "linux",
    program: "/scratch/bin/claude",
    readFile: () => null,
    run: (command, args) => {
      const key = [command, ...args].join(" ");
      calls.push(key);
      const output = outputs[key] ?? { status: 1 };
      return { status: output.status ?? 0, stdout: output.stdout ?? "", stderr: "" };
    },
  };
  return { deps: value, calls };
}

const facts = (captureReady: boolean, changed = true): HostFacts => ({
  id: "claude-code",
  version: "2.1.295",
  registered: true,
  changed,
  captureReady,
  settingsUrl: SETTINGS_URL,
});

describe("claudeCodeSetup.registered", () => {
  it("is true when claude plugin list names omms@omms", () => {
    const { deps: d, calls } = deps({
      "claude plugin list": { stdout: "Installed plugins:\n  ❯ omms@omms\n    Version: 6.4.0\n" },
    });
    expect(claudeCodeSetup.registered(d)).toBe(true);
    expect(calls).toEqual(["claude plugin list"]);
  });

  it("is false for another plugin or a failed command", () => {
    expect(
      claudeCodeSetup.registered(
        deps({ "claude plugin list": { stdout: "  ❯ other@omms\n" } }).deps
      )
    ).toBe(false);
    expect(
      claudeCodeSetup.registered(
        deps({ "claude plugin list": { status: 1, stdout: "omms@omms" } }).deps
      )
    ).toBe(false);
  });
});

describe("claudeCodeSetup.installSteps", () => {
  const marketplaceAdd = ["plugin", "marketplace", "add", "https://github.com/cmdaltctr/omms.git"];
  const install = ["plugin", "install", "omms@omms"];

  it("adds the marketplace, then installs the plugin", () => {
    const { deps: d } = deps({ "claude plugin marketplace list": { stdout: "No marketplaces\n" } });
    expect(claudeCodeSetup.installSteps(d).map((step) => [step.command, ...step.args])).toEqual([
      ["claude", ...marketplaceAdd],
      ["claude", ...install],
    ]);
  });

  it("skips the marketplace step when the omms marketplace is listed", () => {
    const { deps: d } = deps({
      "claude plugin marketplace list": {
        stdout: "Configured marketplaces:\n\n  ❯ omms\n    Source: GitHub (cmdaltctr/omms)\n",
      },
    });
    expect(claudeCodeSetup.installSteps(d).map((step) => [step.command, ...step.args])).toEqual([
      ["claude", ...install],
    ]);
  });

  it("does not take a marketplace named only in a source line", () => {
    const { deps: d } = deps({
      "claude plugin marketplace list": {
        stdout: "  ❯ other-market\n    Source: GitHub (cmdaltctr/omms)\n",
      },
    });
    expect(claudeCodeSetup.installSteps(d)).toHaveLength(2);
  });
});

describe("claudeCodeSetup.nextStep", () => {
  it("names the External API link only when capture is not ready", () => {
    const ready = claudeCodeSetup.nextStep(facts(true));
    expect(ready).toContain("new Claude Code session");
    expect(ready).not.toContain(SETTINGS_URL);
    const notReady = claudeCodeSetup.nextStep(facts(false));
    expect(notReady).toContain("new Claude Code session");
    expect(notReady).toContain("external API");
    expect(notReady).toContain(SETTINGS_URL);
  });

  it("keeps only the External API link for a host this run did not change", () => {
    expect(claudeCodeSetup.nextStep(facts(true, false))).toBe("");
    const notReady = claudeCodeSetup.nextStep(facts(false, false));
    expect(notReady).not.toContain("new Claude Code session");
    expect(notReady).toContain(SETTINGS_URL);
  });
});
