import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetupCommand, type SetupCommandDeps } from "../src/cli/setup-command.js";
import {
  changingCalls,
  fakeCalls,
  scratchEnv,
  writeFakeHost,
  type FakeHost,
  type FakeHostOptions,
} from "./fake-hosts.js";

const SETTINGS_URL = "http://127.0.0.1:4747/settings#settings-section-external-api";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function machine(hosts: Partial<Record<FakeHost, FakeHostOptions>>) {
  const root = mkdtempSync(join(tmpdir(), "omms-cli-setup-"));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  for (const [name, options] of Object.entries(hosts))
    writeFakeHost(bin, name as FakeHost, options);
  const env = scratchEnv(root, bin);
  mkdirSync(env.HOME!, { recursive: true });
  return { root, bin, env };
}

async function setup(
  m: ReturnType<typeof machine>,
  argv: string[],
  options: { tty?: boolean; answer?: string; captureReady?: boolean } = {}
) {
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const deps: SetupCommandDeps = {
    env: m.env,
    home: m.env.HOME!,
    platform: process.platform,
    isTTY: options.tty ?? false,
    ask: async (question) => {
      questions.push(question);
      return options.answer ?? "";
    },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    config: () => ({
      notice: { autoBackfill: true, webServerAutoStart: true },
      claudeCaptureReady: options.captureReady ?? false,
      settingsUrl: SETTINGS_URL,
    }),
  };
  const code = await runSetupCommand(argv, deps);
  return { code, out: out.join("\n"), err: err.join("\n"), questions };
}

const OPENCODE_ADD = "opencode plugin add om-memory-system";
const PI_INSTALL = "pi install npm:om-memory-system";
const CLAUDE_INSTALLS = [
  "claude plugin marketplace add https://github.com/cmdaltctr/omms.git",
  "claude plugin install omms@omms",
];

function registerPi(m: ReturnType<typeof machine>) {
  mkdirSync(m.env.PI_CODING_AGENT_DIR!, { recursive: true });
  writeFileSync(
    join(m.env.PI_CODING_AGENT_DIR!, "settings.json"),
    JSON.stringify({ packages: ["npm:om-memory-system"] })
  );
}

describe("om-memory-system setup", () => {
  it("prints a plan with found, already set up and absent hosts, and runs nothing on --dry-run", async () => {
    const m = machine({ opencode: { version: "2.1.2" }, pi: { version: "0.86.1" } });
    registerPi(m);
    const result = await setup(m, ["--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("OpenCode 2.1.2");
    expect(result.out).toContain(OPENCODE_ADD);
    expect(result.out).toMatch(/Pi 0\.86\.1: already set up/);
    expect(result.out).toMatch(/Claude Code: not found/);
    expect(result.out).toContain("OMMS does these things on its own");
    expect(result.out).toContain('"autoBackfill": false');
    expect(result.out).toContain(
      "To apply this plan, run: npx om-memory-system@latest setup --yes"
    );
    expect(result.questions).toEqual([]);
    expect(changingCalls(m.bin)).toEqual([]);
  });

  it("names the login item only when a host found has one", async () => {
    const claudeOnly = await setup(machine({ claude: {} }), ["--dry-run"]);
    expect(claudeOnly.out).toContain("OMMS does these things on its own");
    expect(claudeOnly.out).not.toContain("webServerAutoStart");
    const withPi = await setup(machine({ claude: {}, pi: {} }), ["--dry-run"]);
    expect(withPi.out).toContain("webServerAutoStart");
  });

  it("warns in the plan when a host is older than the minimum", async () => {
    const m = machine({ opencode: { version: "2.0.10" } });
    const result = await setup(m, ["--dry-run"]);
    expect(result.out).toContain("OpenCode 2.0.22 or later");
  });

  it("runs nothing when the answer is no or Enter", async () => {
    const m = machine({ opencode: {}, pi: {} });
    for (const answer of ["", "n", "no"]) {
      const result = await setup(m, [], { tty: true, answer });
      expect(result.code).toBe(0);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0]).toContain("[y/N]");
    }
    expect(changingCalls(m.bin)).toEqual([]);
  });

  it("prints the plan and the --yes hint, runs nothing and exits 1 from a pipe", async () => {
    const m = machine({ opencode: {} });
    const result = await setup(m, [], { tty: false });
    expect(result.code).toBe(1);
    expect(result.questions).toEqual([]);
    expect(`${result.out}\n${result.err}`).toContain("npx om-memory-system@latest setup --yes");
    expect(changingCalls(m.bin)).toEqual([]);
  });

  it("runs the exact install commands with --yes, then nothing on a second run", async () => {
    const m = machine({ opencode: {}, pi: {}, claude: {} });
    const first = await setup(m, ["--yes"]);
    expect(first.code).toBe(0);
    expect(first.questions).toEqual([]);
    expect(changingCalls(m.bin)).toEqual([OPENCODE_ADD, PI_INSTALL, ...CLAUDE_INSTALLS]);
    expect(first.out).toContain("opencode service restart");
    expect(first.out).toContain("Restart Pi");
    expect(first.out).toContain("external API");
    expect(first.out).toContain(SETTINGS_URL);

    const before = fakeCalls(m.bin).length;
    const second = await setup(m, [], { tty: true, answer: "y" });
    expect(second.code).toBe(0);
    expect(second.questions).toEqual([]);
    expect(second.out).toContain("already set up in every host found");
    expect(changingCalls(m.bin).length).toBe(4);
    expect(fakeCalls(m.bin).length).toBeGreaterThan(before);
  });

  it("gives no next step for a host where nothing changed", async () => {
    const m = machine({ opencode: {}, pi: {} });
    registerPi(m);
    const result = await setup(m, ["--yes"]);
    expect(result.code).toBe(0);
    expect(changingCalls(m.bin)).toEqual([OPENCODE_ADD]);
    expect(result.out).toContain("Pi: already set up.");
    expect(result.out).not.toContain("Restart Pi");
    expect(result.out).toContain("opencode service restart");
  });

  it("asks once and installs on yes", async () => {
    const m = machine({ pi: {} });
    const result = await setup(m, [], { tty: true, answer: "y" });
    expect(result.code).toBe(0);
    expect(changingCalls(m.bin)).toEqual([PI_INSTALL]);
  });

  it("leaves the External API link out when Claude Code capture is ready", async () => {
    const m = machine({ claude: {} });
    const result = await setup(m, ["--yes"], { captureReady: true });
    expect(result.out).toContain("new Claude Code session");
    expect(result.out).not.toContain(SETTINGS_URL);
  });

  it("keeps going when one host fails and exits 1 with the command to run by hand", async () => {
    const m = machine({ opencode: {}, pi: { failInstall: "npm registry unreachable" } });
    const result = await setup(m, ["--yes"]);
    expect(result.code).toBe(1);
    expect(changingCalls(m.bin)).toEqual([OPENCODE_ADD, PI_INSTALL]);
    const text = `${result.out}\n${result.err}`;
    expect(text).toContain("npm registry unreachable");
    expect(text).toMatch(/by hand: pi install npm:om-memory-system/);
    expect(existsSync(join(m.env.XDG_CONFIG_HOME!, "opencode", "opencode.json"))).toBe(true);
  });

  it("changes nothing and exits 1 when no host is found", async () => {
    const m = machine({});
    const result = await setup(m, ["--yes"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("https://opencode.ai");
    expect(result.out).toContain("pi-coding-agent");
    expect(result.out).toContain("claude.com");
    expect(fakeCalls(m.bin)).toEqual([]);
  });

  it("adds the entry to an existing cli.json and names the file in the plan", async () => {
    const m = machine({ opencode: {} });
    const folder = join(m.env.XDG_CONFIG_HOME!, "opencode");
    mkdirSync(folder, { recursive: true });
    const cli = join(folder, "cli.json");
    writeFileSync(cli, '{\n  "theme": "dark",\n  "plugins": ["other-plugin"]\n}\n');
    const result = await setup(m, ["--yes"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(cli);
    expect(JSON.parse(readFileSync(cli, "utf8"))).toEqual({
      theme: "dark",
      plugins: ["other-plugin", "om-memory-system"],
    });
  });

  it("adds a missing cli.json entry even when OpenCode is already registered", async () => {
    const m = machine({ opencode: {} });
    const folder = join(m.env.XDG_CONFIG_HOME!, "opencode");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "opencode.json"), '{"plugins":["om-memory-system"]}');
    writeFileSync(join(folder, "cli.json"), "{}");
    const result = await setup(m, ["--yes"]);
    expect(result.code).toBe(0);
    expect(changingCalls(m.bin)).toEqual([]);
    expect(JSON.parse(readFileSync(join(folder, "cli.json"), "utf8")).plugins).toEqual([
      "om-memory-system",
    ]);
  });

  it("never creates cli.json and prints the manual step", async () => {
    const m = machine({ opencode: {} });
    const result = await setup(m, ["--yes"]);
    expect(result.code).toBe(0);
    expect(existsSync(join(m.env.XDG_CONFIG_HOME!, "opencode", "cli.json"))).toBe(false);
    expect(result.out).toContain("Start OpenCode once");
  });

  it("is dispatched by the CLI, with doctor, and both are listed in the help", async () => {
    const { runCli } = await import("../src/cli/index.js");
    const printed: string[] = [];
    const log = spyOn(console, "log").mockImplementation((text: unknown) => {
      printed.push(String(text));
    });
    try {
      expect(await runCli(["setup", "--help"])).toBe(0);
      expect(printed.join("\n")).toContain("Usage: om-memory-system setup");
      expect(await runCli(["doctor", "--help"])).toBe(0);
      expect(printed.join("\n")).toContain("Usage: om-memory-system doctor");
      printed.length = 0;
      expect(await runCli(["--help"])).toBe(0);
      expect(printed.join("\n")).toMatch(/^ {2}setup /m);
      expect(printed.join("\n")).toMatch(/^ {2}doctor /m);
    } finally {
      log.mockRestore();
    }
  });

  it("prints help", async () => {
    const m = machine({});
    const result = await setup(m, ["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("--dry-run");
    expect(result.out).toContain("--yes");
  });
});
