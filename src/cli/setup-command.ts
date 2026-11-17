import type { HostFacts } from "../core/host-setup.js";
import { firstRunNoticeLines, type FirstRunNoticeConfig } from "../services/first-run-notice.js";
import { belowMinimum, detectHosts, type DetectedHost, type Machine } from "./host-setups.js";

// `om-memory-system setup`: find each host, print a plan, ask once, then install
// OMMS through each host's own command. A host that already has OMMS is left alone,
// so a second run changes nothing.

export const setupUsage = `Usage: om-memory-system setup [--yes] [--dry-run]

Finds OpenCode, Pi and Claude Code on this computer and adds OMMS to each one
through the host's own install command. It prints a plan and asks before it
changes anything. A host that already has OMMS is left alone.

Options:
  --yes, -y   Set up without the question (for scripts)
  --dry-run   Print the plan only; change nothing
  --help, -h  Show this help`;

/** What `setup` reads from the OMMS config. */
export interface SetupConfig {
  notice: FirstRunNoticeConfig;
  claudeCaptureReady: boolean;
  /** Link to the External API card on the Settings page. */
  settingsUrl: string;
}

export interface SetupCommandDeps extends Machine {
  /** True when standard input is an interactive terminal. */
  isTTY: boolean;
  ask(question: string): Promise<string>;
  out(text: string): void;
  err(text: string): void;
  config(): SetupConfig;
}

const commandText = (step: { command: string; args: string[] }) =>
  [step.command, ...step.args].join(" ");

/** Hosts found on this computer with work left to do. */
function pending(hosts: DetectedHost[]): DetectedHost[] {
  return hosts.filter(
    (host) => host.program && (!host.registered || host.files.some((file) => file.state === "add"))
  );
}

function planLines(hosts: DetectedHost[], config: SetupConfig): string[] {
  const lines = ["OMMS setup plan:", ""];
  for (const host of hosts) {
    const { name, minVersion } = host.setup;
    if (!host.program) {
      lines.push(`- ${name}: not found.`);
      continue;
    }
    const label = host.version ? `${name} ${host.version}` : name;
    if (host.registered) lines.push(`- ${label}: already set up.`);
    else {
      lines.push(`- ${label}: will run`);
      for (const step of host.setup.installSteps(host.deps)) lines.push(`    ${commandText(step)}`);
    }
    if (belowMinimum(host.version, minVersion)) {
      lines.push(`  Warning: ${name} ${minVersion} or later is needed for every OMMS feature.`);
    }
    for (const file of host.files) {
      if (file.state === "add") lines.push(`  Will add "om-memory-system" to ${file.path}`);
      else if (file.state !== "present") lines.push(`  Note: ${file.reason}`, `  ${file.fix}`);
    }
  }
  // Each host's notice differs only in the parts it leaves out; show each line once.
  const notice = [
    ...new Set(
      hosts
        .filter((host) => host.program)
        .flatMap((host) => firstRunNoticeLines(config.notice, host.setup))
    ),
  ];
  if (notice.length > 0) lines.push("", ...notice);
  return lines;
}

/** Runs one host's steps. Returns the failure text, or null when every step worked. */
function install(host: DetectedHost): string | null {
  if (!host.registered) {
    for (const step of host.setup.installSteps(host.deps)) {
      const result = host.deps.run(step.command, step.args);
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout).trim().split("\n")[0] || "no output";
        return `"${commandText(step)}" failed: ${detail}\n  Run it by hand: ${commandText(step)}`;
      }
    }
  }
  for (const file of host.files.filter((entry) => entry.state === "add")) {
    try {
      file.apply();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `could not write ${file.path}: ${detail}\n  ${file.fix}`;
    }
  }
  return null;
}

export async function runSetupCommand(argv: string[], deps: SetupCommandDeps): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    deps.out(setupUsage);
    return 0;
  }
  const unknown = argv.filter((arg) => !["--yes", "-y", "--dry-run"].includes(arg));
  if (unknown.length > 0) {
    deps.err(`Unknown option: ${unknown.join(" ")}\n\n${setupUsage}`);
    return 1;
  }
  const yes = argv.includes("--yes") || argv.includes("-y");
  const dryRun = argv.includes("--dry-run");
  const hosts = detectHosts(deps);
  if (!hosts.some((host) => host.program)) {
    deps.out("No OpenCode, Pi or Claude Code was found on this computer. Nothing changed.");
    deps.out("Install a host first, then run: npx om-memory-system@latest setup");
    for (const host of hosts) deps.out(`- ${host.setup.name}: ${host.setup.homepage}`);
    return 1;
  }
  const config = deps.config();
  deps.out(planLines(hosts, config).join("\n"));
  const work = pending(hosts);
  if (work.length === 0) {
    deps.out("\nOMMS is already set up in every host found. Nothing changed.");
    return 0;
  }
  if (dryRun) {
    deps.out("\nDry run: nothing changed.");
    deps.out("To apply this plan, run: npx om-memory-system@latest setup --yes");
    return 0;
  }
  if (!yes) {
    if (!deps.isTTY) {
      deps.out(
        "\nNothing changed. To set up without a question, run: npx om-memory-system@latest setup --yes"
      );
      return 1;
    }
    const answer = (await deps.ask("\nSet up OMMS in these hosts? [y/N] ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      deps.out("Nothing changed.");
      return 0;
    }
  }
  let failed = false;
  deps.out("");
  for (const host of hosts.filter((entry) => entry.program)) {
    const error = work.includes(host) ? install(host) : null;
    const facts: HostFacts = {
      id: host.setup.id,
      version: host.version,
      registered: host.registered || error === null,
      changed: work.includes(host),
      captureReady: config.claudeCaptureReady,
      settingsUrl: config.settingsUrl,
    };
    if (error) {
      failed = true;
      deps.out(`✗ ${host.setup.name}: ${error}`);
      continue;
    }
    deps.out(`✓ ${host.setup.name}: ${work.includes(host) ? "set up" : "already set up"}.`);
    const next = host.setup.nextStep(facts);
    if (next) deps.out(`  Next: ${next}`);
    for (const file of host.files.filter(
      (entry) => entry.state === "missing" || entry.state === "broken"
    )) {
      deps.out(`  Note: ${file.reason}\n  ${file.fix}`);
    }
  }
  return failed ? 1 : 0;
}

/** The real terminal, environment and OMMS config. */
export async function productionSetupDeps(): Promise<SetupCommandDeps> {
  const [{ homedir }, { createInterface }, config, { claudeCaptureState }, { webServerUrl }] =
    await Promise.all([
      import("node:os"),
      import("node:readline/promises"),
      import("../config.js"),
      import("../services/claude-capture-state.js"),
      import("../services/web-api-auth.js"),
    ]);
  const home = homedir();
  return {
    env: process.env,
    home,
    platform: process.platform,
    isTTY: process.stdin.isTTY === true,
    async ask(question) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await prompt.question(question);
      } finally {
        prompt.close();
      }
    },
    out: (text) => console.log(text),
    err: (text) => console.error(text),
    config() {
      config.initConfig(home);
      const { CONFIG } = config;
      return {
        notice: CONFIG,
        claudeCaptureReady: claudeCaptureState(CONFIG) !== "needs-setup",
        settingsUrl: `${webServerUrl(CONFIG.webServerHost, CONFIG.webServerPort)}/settings#settings-section-external-api`,
      };
    },
  };
}
