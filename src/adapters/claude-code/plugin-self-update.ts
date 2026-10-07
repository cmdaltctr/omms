import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { availableUpdate, latestNpmVersion } from "../../services/update-check.js";

// Claude Code installs the OMMS plugin from the `stable` branch, but its own
// update pass runs at its own time and can leave a new session on the old
// plugin. At session start OMMS compares the plugin with npm `latest` and, when
// it is older, runs Claude Code's own update commands in the background. The
// new copy loads in the next session or after /reload-plugins.

/** A second session does not start another update for the same release within this time. */
export const SELF_UPDATE_RETRY_MS = 30 * 60 * 1000;

export type PluginSelfUpdateCode =
  | "started"
  | "current"
  | "recent"
  | "disabled"
  | "no-plugin"
  | "unreadable-plugin"
  | "unreachable"
  | "spawn-failed";

export interface PluginSelfUpdateDeps {
  /** False when `OMMS_DISABLE_UPDATE_CHECK` is `1`. */
  enabled: boolean;
  /** `CLAUDE_PLUGIN_ROOT`; undefined outside a Claude plugin. */
  pluginRoot: string | undefined;
  readPluginVersion: (root: string) => string;
  fetch: typeof fetch;
  now: () => number;
  readMarker: () => { version: string; startedAt: number } | null;
  writeMarker: (value: { version: string; startedAt: number }) => void;
  /** Start a process that outlives this hook. */
  spawnDetached: (command: string, args: string[]) => void;
  log: (message: string, data: Record<string, unknown>) => void | Promise<void>;
}

/** Node script that refreshes the marketplace, then updates the plugin. Run detached. */
const UPDATE_SCRIPT = `
const { spawnSync } = require("node:child_process");
const shell = process.platform === "win32";
for (const args of [["plugin", "marketplace", "update", "omms"], ["plugin", "update", "omms@omms"]]) {
  const run = spawnSync("claude", args, { stdio: "ignore", shell, timeout: 120000 });
  if (run.status !== 0) process.exit(1);
}
`;

/** Start a background plugin update when npm has a newer release. Never throws. */
export async function startPluginSelfUpdate(
  deps: PluginSelfUpdateDeps
): Promise<PluginSelfUpdateCode> {
  const code = await decide(deps);
  if (code.code === "started" || code.code === "spawn-failed") {
    await deps.log("Claude plugin self-update", {
      code: code.code,
      plugin: code.plugin,
      latest: code.latest,
    });
  }
  return code.code;
}

async function decide(
  deps: PluginSelfUpdateDeps
): Promise<{ code: PluginSelfUpdateCode; plugin?: string; latest?: string }> {
  if (!deps.enabled) return { code: "disabled" };
  if (!deps.pluginRoot) return { code: "no-plugin" };
  let plugin: string;
  try {
    plugin = deps.readPluginVersion(deps.pluginRoot);
  } catch {
    return { code: "unreadable-plugin" };
  }
  const latest = await latestNpmVersion(deps.fetch);
  if (latest === null) return { code: "unreachable" };
  const newer = availableUpdate(plugin, latest);
  if (!newer) return { code: "current" };

  const marker = deps.readMarker();
  const now = deps.now();
  if (marker?.version === newer && now - marker.startedAt <= SELF_UPDATE_RETRY_MS) {
    return { code: "recent" };
  }
  // Write first, so a session that starts during the update does not start another.
  deps.writeMarker({ version: newer, startedAt: now });
  try {
    deps.spawnDetached(process.execPath, ["-e", UPDATE_SCRIPT]);
  } catch {
    return { code: "spawn-failed", plugin, latest: newer };
  }
  return { code: "started", plugin, latest: newer };
}

/** Production inputs: the real plugin manifest, npm, and a marker file in ~/.omms. */
export function pluginSelfUpdateDeps(
  log: PluginSelfUpdateDeps["log"],
  env: NodeJS.ProcessEnv = process.env
): PluginSelfUpdateDeps {
  const markerPath = join(homedir(), ".omms", "claude-plugin-update.json");
  return {
    enabled: env.OMMS_DISABLE_UPDATE_CHECK !== "1",
    pluginRoot: env.CLAUDE_PLUGIN_ROOT || undefined,
    readPluginVersion: (root) => {
      const manifest = JSON.parse(
        readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")
      ) as { version?: unknown };
      if (typeof manifest.version !== "string") throw new Error("no version");
      return manifest.version;
    },
    fetch: globalThis.fetch,
    now: Date.now,
    readMarker: () => {
      try {
        const value = JSON.parse(readFileSync(markerPath, "utf8")) as {
          version?: unknown;
          startedAt?: unknown;
        };
        return typeof value.version === "string" && typeof value.startedAt === "number"
          ? { version: value.version, startedAt: value.startedAt }
          : null;
      } catch {
        return null;
      }
    },
    writeMarker: (value) => {
      mkdirSync(dirname(markerPath), { recursive: true });
      writeFileSync(markerPath, JSON.stringify(value));
    },
    spawnDetached: (command, args) => {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.on("error", () => {});
      child.unref();
    },
    log,
  };
}
