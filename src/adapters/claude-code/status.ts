import { homedir } from "node:os";
import { latestNpmVersion } from "../../services/update-check.js";

// What the Claude Code status line mod asks for: where the web app's health
// route is, which OMMS version answered, and the newest release on npm. The mod
// keeps no OMMS logic; it polls the health URL and compares the two versions.

export interface ClaudeStatus {
  healthUrl: string;
  /** The version of the OMMS copy that ran this command. */
  version: string;
  /** The `latest` version on npm, or null when the check is off or fails. */
  latest: string | null;
}

export interface ClaudeStatusInputs {
  config: { webServerHost: string; webServerPort: number };
  version: string;
  checkUpdates: boolean;
}

/** Options for tests; production reads the global config and the package version. */
export interface ClaudeStatusOptions {
  statusInputs?: () => Promise<ClaudeStatusInputs>;
}

/** Pure: `CONFIG` is passed in, because tests stub `src/config.js`. */
export async function buildClaudeStatus(
  inputs: ClaudeStatusInputs & { fetch: typeof fetch }
): Promise<ClaudeStatus> {
  const { webServerHost, webServerPort } = inputs.config;
  const host = webServerHost === "0.0.0.0" ? "127.0.0.1" : webServerHost;
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return {
    healthUrl: `http://${urlHost}:${webServerPort}/api/health`,
    version: inputs.version,
    latest: inputs.checkUpdates ? await latestNpmVersion(inputs.fetch) : null,
  };
}

/** The global config and this copy's version, as `om-memory-system web` reads them. */
export async function loadClaudeStatusInputs(): Promise<ClaudeStatusInputs> {
  // Importing the config on a first run prints "Created config template" with
  // console.log. Stdout must hold only the JSON line, so that goes to stderr.
  const log = console.log;
  console.log = console.error;
  try {
    const config = await import("../../config.js");
    config.initConfig(homedir());
    const { packageVersion } = await import("../../services/package-version.js");
    return {
      config: config.CONFIG,
      version: packageVersion(),
      checkUpdates: process.env.OMMS_DISABLE_UPDATE_CHECK !== "1",
    };
  } finally {
    console.log = log;
  }
}
