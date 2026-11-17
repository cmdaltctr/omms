import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import type { HostSetup, HostSetupDeps, SetupFileCheck } from "../core/host-setup.js";
import { claudeCodeSetup } from "../adapters/claude-code/setup.js";
import { opencodeSetup } from "../adapters/opencode/setup.js";
import { piSetup } from "../adapters/pi/setup.js";
import { findProgram } from "../services/find-program.js";
import { compareVersions } from "../services/version-compare.js";

// The hosts `setup` and `doctor` know, and the read-only detection both share.
// Host-specific rules live in each adapter's `setup.ts`; this file only lists them.

export const HOST_SETUPS: HostSetup[] = [opencodeSetup, piSetup, claudeCodeSetup];

/** The machine as `setup` and `doctor` see it. A test passes a scratch home and `PATH`. */
export interface Machine {
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
}

export interface DetectedHost {
  setup: HostSetup;
  /** Null when the host is not installed. */
  program: string | null;
  version: string | null;
  registered: boolean;
  deps: HostSetupDeps;
  files: SetupFileCheck[];
}

const INSTALL_TIMEOUT_MS = 120_000;
const VERSION_TIMEOUT_MS = 10_000;

/**
 * Runs a host command the way self-update does (`shell` on Windows, hidden window),
 * but synchronously with captured output. The host's folder goes first on `PATH`, so a
 * host found in an install folder outside `PATH` still runs by its bare name.
 */
export function hostRunner(
  machine: Machine,
  program: string | null,
  timeoutMs: number
): HostSetupDeps["run"] {
  const windows = machine.platform === "win32";
  const pathKey = Object.keys(machine.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const folder = program ? (windows ? win32 : posix).dirname(program) : "";
  const env = {
    ...machine.env,
    [pathKey]: [folder, machine.env[pathKey]].filter(Boolean).join(windows ? ";" : ":"),
  };
  return (command, args) => {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      env,
      shell: windows,
      windowsHide: true,
      timeout: timeoutMs,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr || result.error?.message || "",
    };
  };
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The first `x.y.z` in a `--version` reply. */
export function parseVersion(text: string): string | null {
  return /\d+\.\d+\.\d+/.exec(text)?.[0] ?? null;
}

/** True only for a known version that is older than the minimum. */
export function belowMinimum(version: string | null, minimum: string): boolean {
  return version !== null && (compareVersions(version, minimum) ?? 0) < 0;
}

/** Finds each host and reads its state. Read-only: it runs only version and list commands. */
export function detectHosts(machine: Machine, setups = HOST_SETUPS): DetectedHost[] {
  return setups.map((setup) => {
    const program = findProgram(setup.binary, setup.extraFolders(machine.home), machine);
    const deps: HostSetupDeps = {
      ...machine,
      program,
      readFile: readText,
      run: hostRunner(machine, program, INSTALL_TIMEOUT_MS),
    };
    if (!program) return { setup, program, version: null, registered: false, deps, files: [] };
    const reply = hostRunner(machine, program, VERSION_TIMEOUT_MS)(setup.binary, ["--version"]);
    return {
      setup,
      program,
      version: parseVersion(reply.stdout),
      registered: setup.registered(deps),
      deps,
      files: setup.fileChecks?.(deps) ?? [],
    };
  });
}
