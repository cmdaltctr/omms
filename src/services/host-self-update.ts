import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { availableUpdate, latestNpmVersion } from "./update-check.js";

// Pi and OpenCode install OMMS from npm, but neither updates its plugins by
// itself. At session start OMMS compares the running copy with npm `latest`
// and, when it is older, runs the host's own update command in a detached
// process. That process writes the result into a marker file, which the
// running plugin reads to tell the user to restart. Claude Code has its own
// module (`src/adapters/claude-code/plugin-self-update.ts`).

/** A second session does not start another update for the same release within this time. */
export const HOST_SELF_UPDATE_RETRY_MS = 30 * 60 * 1000;
/** How often a running plugin reads the marker while an update is pending. */
export const HOST_UPDATE_POLL_MS = 60 * 1000;
/** How long a running plugin reads the marker before it gives up. */
export const HOST_UPDATE_POLL_LIMIT_MS = 10 * 60 * 1000;
/** The longest time the detached process lets the host command run. */
const HOST_COMMAND_TIMEOUT_MS = 120_000;

export type HostSelfUpdateCode =
  | "started"
  | "current"
  | "recent"
  | "disabled"
  | "unreachable"
  | "local"
  | "pinned"
  | "spawn-failed";

/** How the host installed this copy. Only "npm" (unpinned) is updated. */
export type HostInstallSource = "npm" | "local" | "pinned";

export interface HostUpdateMarker {
  version: string;
  startedAt: number;
  outcome?: "installed" | "failed";
  finishedAt?: number;
}

export type HostUpdateStatus = "pending" | "installed" | "failed";

export interface HostSelfUpdateDeps {
  /** False when `OMMS_DISABLE_UPDATE_CHECK` is `1`. */
  enabled: boolean;
  /** Log message, for example `Pi plugin self-update`. */
  logLabel: string;
  currentVersion: string;
  /** The host's own update command, for example `pi` with `["update", "npm:om-memory-system"]`. */
  command: string;
  args: string[];
  /** The marker the detached process writes its result into. */
  markerPath: string;
  installSource: () => HostInstallSource;
  fetch: typeof fetch;
  now: () => number;
  readMarker: () => HostUpdateMarker | null;
  writeMarker: (value: HostUpdateMarker) => void;
  /** Start a process that outlives this session. */
  spawnDetached: (command: string, args: string[]) => void;
  log: (message: string, data: Record<string, unknown>) => void | Promise<void>;
}

export interface HostSelfUpdateResult {
  code: HostSelfUpdateCode;
  /** The newer release on npm, or null when there is none to report. */
  update: string | null;
}

/**
 * Node or Bun script that runs the host command, then records the outcome in
 * the marker. Arguments: marker path, marker JSON, command, command args.
 * `BUN_BE_BUN` lets a compiled Bun host (OpenCode) run this script; the host
 * command must not inherit it.
 */
const UPDATE_SCRIPT = `
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const [markerPath, markerJson, command, ...args] = process.argv.slice(1);
const env = { ...process.env };
delete env.BUN_BE_BUN;
let ok = false;
try {
  const run = spawnSync(command, args, {
    stdio: "ignore",
    shell: process.platform === "win32",
    windowsHide: true,
    timeout: ${HOST_COMMAND_TIMEOUT_MS},
    env,
  });
  ok = run.status === 0;
} catch {}
const marker = JSON.parse(markerJson);
writeFileSync(markerPath, JSON.stringify({ ...marker, outcome: ok ? "installed" : "failed", finishedAt: Date.now() }));
`;

/** Arguments for the script runner (`node` or Bun) that runs the host command detached. */
export function hostUpdateRunnerArgs(
  markerPath: string,
  marker: HostUpdateMarker,
  command: string,
  args: string[]
): string[] {
  return ["-e", UPDATE_SCRIPT, markerPath, JSON.stringify(marker), command, ...args];
}

/** Start a background host update when npm has a newer release. Never throws. */
export async function startHostSelfUpdate(deps: HostSelfUpdateDeps): Promise<HostSelfUpdateResult> {
  const result = await decide(deps);
  if (result.code === "started" || result.code === "spawn-failed") {
    try {
      await deps.log(deps.logLabel, {
        code: result.code,
        current: deps.currentVersion,
        latest: result.update,
      });
    } catch {
      // A failed log write must not change the update result.
    }
  }
  return result;
}

async function decide(deps: HostSelfUpdateDeps): Promise<HostSelfUpdateResult> {
  if (!deps.enabled) return { code: "disabled", update: null };
  const latest = await latestNpmVersion(deps.fetch);
  if (latest === null) return { code: "unreachable", update: null };
  const update = availableUpdate(deps.currentVersion, latest);
  if (!update) return { code: "current", update: null };

  let source: HostInstallSource;
  try {
    source = deps.installSource();
  } catch {
    source = "pinned";
  }
  if (source !== "npm") return { code: source, update };

  const marker = deps.readMarker();
  const now = deps.now();
  if (marker?.version === update && now - marker.startedAt <= HOST_SELF_UPDATE_RETRY_MS) {
    return { code: "recent", update };
  }
  const started: HostUpdateMarker = { version: update, startedAt: now };
  try {
    // Write first, so a session that starts during the update does not start another.
    deps.writeMarker(started);
    deps.spawnDetached(
      process.execPath,
      hostUpdateRunnerArgs(deps.markerPath, started, deps.command, deps.args)
    );
  } catch {
    return { code: "spawn-failed", update };
  }
  return { code: "started", update };
}

/** The state of the update for `version` that the marker records, or null. */
export function markerStatus(
  marker: HostUpdateMarker | null,
  version: string
): HostUpdateStatus | null {
  if (!marker || marker.version !== version) return null;
  return marker.outcome ?? "pending";
}

/** Read a marker file. A missing, unreadable or malformed file is no marker. */
export function readMarkerFile(path: string): HostUpdateMarker | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof value.version !== "string" || typeof value.startedAt !== "number") return null;
    const marker: HostUpdateMarker = { version: value.version, startedAt: value.startedAt };
    if (value.outcome === "installed" || value.outcome === "failed") {
      marker.outcome = value.outcome;
      if (typeof value.finishedAt === "number") marker.finishedAt = value.finishedAt;
    }
    return marker;
  } catch {
    return null;
  }
}

/**
 * Read the marker now, then every `intervalMs` until it holds an outcome or
 * `maxMs` passes. Calls `onSettled` once with the outcome. Returns a stop function.
 */
export function watchHostUpdate(options: {
  read: () => HostUpdateStatus | null;
  onSettled: (status: "installed" | "failed") => void;
  intervalMs?: number;
  maxMs?: number;
}): () => void {
  const intervalMs = options.intervalMs ?? HOST_UPDATE_POLL_MS;
  const deadline = Date.now() + (options.maxMs ?? HOST_UPDATE_POLL_LIMIT_MS);
  let timer: ReturnType<typeof setInterval> | undefined;
  let done = false;
  const stop = () => {
    done = true;
    if (timer) clearInterval(timer);
  };
  const check = () => {
    if (done) return;
    const status = options.read();
    if (status === "installed" || status === "failed") {
      stop();
      options.onSettled(status);
    } else if (Date.now() >= deadline) {
      stop();
    }
  };
  check();
  if (!done) {
    timer = setInterval(check, intervalMs);
    timer.unref?.();
  }
  return stop;
}

/** True when the module file sits in an npm install of om-memory-system. */
export function installedFromNpm(modulePath: string): boolean {
  return modulePath.replaceAll("\\", "/").includes("/node_modules/om-memory-system/");
}

/**
 * True when the module sits in a host package cache folder named
 * `om-memory-system` or `om-memory-system@latest`. Any other folder, such as
 * one with a version, counts as pinned.
 */
export function unpinnedCacheFolder(modulePath: string): boolean {
  const parts = modulePath.replaceAll("\\", "/").split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index < 1 || parts[index + 1] !== "om-memory-system") return false;
  const folder = parts[index - 1];
  return folder === "om-memory-system" || folder === "om-memory-system@latest";
}

/**
 * True when a settings file lists `npm:om-memory-system` in `packages` with no
 * version. A file that cannot be read, or an entry with a version, counts as pinned.
 */
export function unpinnedPackageSource(settingsText: string | null): boolean {
  if (settingsText === null) return false;
  let packages: unknown;
  try {
    packages = (JSON.parse(settingsText) as { packages?: unknown }).packages;
  } catch {
    return false;
  }
  if (!Array.isArray(packages)) return false;
  return packages.some((entry: unknown) => {
    const source =
      typeof entry === "string" ? entry : (entry as { source?: unknown } | null)?.source;
    return source === "npm:om-memory-system";
  });
}

/** Footer text after the status glyph: a newer release, or one installed and waiting for a restart. */
export function updateSuffix(update: string, state: "available" | "installed"): string {
  return state === "installed" ? ` · ${update} installed, restart` : ` · ${update} available`;
}

/** The one-time message for each update state. */
export function updateNotice(options: {
  hostName: string;
  command: string;
  current: string;
  update: string;
  state: "available" | "installing" | "installed";
}): string {
  const { hostName, command, current, update, state } = options;
  if (state === "installing") return `om-memory-system ${update} is installing in the background.`;
  if (state === "installed")
    return `om-memory-system ${update} installed. Restart ${hostName} to use it.`;
  return `om-memory-system ${update} is available (running ${current}). Run: ${command}, then restart ${hostName}.`;
}

/** Production inputs: npm, the marker file, and a detached script runner. */
export function hostSelfUpdateDeps(options: {
  logLabel: string;
  currentVersion: string;
  command: string;
  args: string[];
  markerPath: string;
  installSource: () => HostInstallSource;
  log: HostSelfUpdateDeps["log"];
  env?: NodeJS.ProcessEnv;
}): HostSelfUpdateDeps {
  const env = options.env ?? process.env;
  return {
    ...options,
    enabled: env.OMMS_DISABLE_UPDATE_CHECK !== "1",
    fetch: globalThis.fetch.bind(globalThis),
    now: Date.now,
    readMarker: () => readMarkerFile(options.markerPath),
    writeMarker: (value) => {
      mkdirSync(dirname(options.markerPath), { recursive: true });
      writeFileSync(options.markerPath, JSON.stringify(value));
    },
    spawnDetached: (command, args) => {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...env, BUN_BE_BUN: "1" },
      });
      child.on("error", () => {});
      child.unref();
    },
  };
}
