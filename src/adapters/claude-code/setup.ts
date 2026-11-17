import { join } from "node:path";
import type { HostSetup } from "../../core/host-setup.js";

// How `setup` and `doctor` see Claude Code. Registration comes from Claude
// Code's own `claude plugin list`; `setup` installs through Claude Code's plugin
// commands. The update commands live in `plugin-self-update.ts`.

const MARKETPLACE_ADD_ARGS = [
  "plugin",
  "marketplace",
  "add",
  "https://github.com/cmdaltctr/omms.git",
];
const PLUGIN_INSTALL_ARGS = ["plugin", "install", "omms@omms"];

/** `omms` as a name of its own, not part of `cmdaltctr/omms` or `omms@omms`. */
const OMMS_MARKETPLACE = /(?<![\w@/.-])omms(?![\w@/.-])/;

export const claudeCodeSetup: HostSetup = {
  id: "claude-code",
  name: "Claude Code",
  homepage: "https://code.claude.com/docs",
  binary: "claude",
  extraFolders: (home) => [join(home, ".local", "bin")],
  minVersion: "2.1.295",
  // Claude Code never calls `reconcileWebAutostart`, so it installs no login item.
  loginItem: false,
  registered(deps) {
    const result = deps.run("claude", ["plugin", "list"]);
    return result.status === 0 && result.stdout.includes("omms@omms");
  },
  installSteps(deps) {
    const list = deps.run("claude", ["plugin", "marketplace", "list"]);
    const hasMarketplace = list.status === 0 && OMMS_MARKETPLACE.test(list.stdout);
    return [
      ...(hasMarketplace
        ? []
        : [{ label: "Add the OMMS marketplace", command: "claude", args: MARKETPLACE_ADD_ARGS }]),
      { label: "Install the OMMS plugin", command: "claude", args: PLUGIN_INSTALL_ARGS },
    ];
  },
  nextStep(facts) {
    const capture = facts.captureReady
      ? ""
      : `Capture needs the external API: fill in the External API card at ${facts.settingsUrl}`;
    return [facts.changed ? "Start a new Claude Code session." : "", capture]
      .filter(Boolean)
      .join(" ");
  },
};
