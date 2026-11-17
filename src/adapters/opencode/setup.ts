import { randomUUID } from "node:crypto";
import { chmodSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { HostSetup, HostSetupDeps, SetupFileCheck } from "../../core/host-setup.js";
import { OPENCODE_INSTALL_ARGS } from "./self-update.js";

// How `setup` and `doctor` see OpenCode. Registration is read from the global
// `opencode.json(c)`; `setup` installs through `opencode plugin add`. The one
// file OMMS writes is an existing `cli.json`, where `opencode plugin update`
// looks for the entry. OMMS never creates or repairs that file.

const PACKAGE = "om-memory-system";

function configFolder(deps: Pick<HostSetupDeps, "env" | "home">): string {
  return join(deps.env.XDG_CONFIG_HOME || join(deps.home, ".config"), "opencode");
}

/** True for `om-memory-system`, `om-memory-system@<version>` and `{ "package": … }`. */
function namesPackage(entry: unknown): boolean {
  const name = typeof entry === "string" ? entry : (entry as { package?: unknown } | null)?.package;
  return typeof name === "string" && (name === PACKAGE || name.startsWith(`${PACKAGE}@`));
}

/** The parsed root object, or null when the text is not a JSONC object. */
function parseObject(text: string): Record<string, unknown> | null {
  const errors: ParseError[] = [];
  const root: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !root || typeof root !== "object" || Array.isArray(root)) return null;
  return root as Record<string, unknown>;
}

export type CliJsonMerge =
  { state: "present" } | { state: "broken" } | { state: "add"; text: string };

/** Adds the entry to `cli.json` text, keeping every other key, entry and comment. */
export function mergeCliJson(text: string): CliJsonMerge {
  const root = parseObject(text);
  if (!root) return { state: "broken" };
  const plugins = root.plugins;
  if (plugins !== undefined && !Array.isArray(plugins)) return { state: "broken" };
  if (plugins?.some(namesPackage)) return { state: "present" };
  // Match the file's own indent and line ends. jsonc-parser lays out only the edited part.
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  const tabs = indent.startsWith("\t");
  const formattingOptions = {
    insertSpaces: !tabs,
    tabSize: tabs ? 1 : indent.length,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
  const edits = plugins
    ? modify(text, ["plugins", -1], PACKAGE, { formattingOptions, isArrayInsertion: true })
    : modify(text, ["plugins"], [PACKAGE], { formattingOptions });
  return { state: "add", text: applyEdits(text, edits) };
}

/**
 * Replaces an existing file atomically. A symbolic link (stow, home-manager) stays a
 * link: the temporary file goes beside the real file and replaces it. The mode stays.
 */
function writeAtomic(path: string, text: string): void {
  const real = realpathSync(path);
  const mode = statSync(real).mode & 0o7777;
  const temp = join(dirname(real), `.cli.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, text, { mode });
    chmodSync(temp, mode);
    renameSync(temp, real);
  } finally {
    rmSync(temp, { force: true });
  }
}

function cliJsonCheck(deps: HostSetupDeps): SetupFileCheck {
  const path = join(configFolder(deps), "cli.json");
  const text = deps.readFile(path);
  const merge: CliJsonMerge | { state: "missing" } =
    text === null ? { state: "missing" } : mergeCliJson(text);
  const byHand = `add "${PACKAGE}" to the "plugins" list in ${path}`;
  const words = {
    present: { reason: "", fix: "" },
    add: {
      reason: `${path} does not list ${PACKAGE}, so "opencode plugin update" cannot update OMMS.`,
      fix: `Run: npx om-memory-system@latest setup, or ${byHand}.`,
    },
    missing: {
      reason: `${path} does not exist yet, so "opencode plugin update" cannot update OMMS.`,
      fix: "Start OpenCode once, then run: npx om-memory-system@latest setup.",
    },
    broken: {
      reason: `${path} cannot be read as JSON, or its "plugins" value is not a list. OMMS left it unchanged.`,
      fix: `Fix the file by hand, then ${byHand}.`,
    },
  }[merge.state];
  return {
    check: "OpenCode auto-update",
    path,
    state: merge.state,
    ...words,
    apply() {
      if (merge.state !== "add") throw new Error(`cli.json is ${merge.state}; nothing written`);
      // The question and "opencode plugin add" ran since detection: merge the file as it is now.
      const now = deps.readFile(path);
      const fresh = now === null ? { state: "missing" as const } : mergeCliJson(now);
      if (fresh.state === "present") return;
      if (fresh.state !== "add") throw new Error(`cli.json is ${fresh.state}; nothing written`);
      writeAtomic(path, fresh.text);
    },
  };
}

export const opencodeSetup: HostSetup = {
  id: "opencode",
  name: "OpenCode",
  homepage: "https://opencode.ai",
  binary: "opencode",
  extraFolders: (home) => [join(home, ".opencode", "bin")],
  minVersion: "2.0.22",
  loginItem: true,
  registered(deps) {
    const folder = configFolder(deps);
    return ["opencode.json", "opencode.jsonc"].some((file) => {
      const text = deps.readFile(join(folder, file));
      const plugins = text === null ? undefined : parseObject(text)?.plugins;
      return Array.isArray(plugins) && plugins.some(namesPackage);
    });
  },
  installSteps: () => [
    { label: "Add the OMMS plugin to OpenCode", command: "opencode", args: OPENCODE_INSTALL_ARGS },
  ],
  nextStep: (facts) =>
    facts.changed ? "Restart OpenCode, then run: opencode service restart" : "",
  fileChecks: (deps) => [cliJsonCheck(deps)],
};
