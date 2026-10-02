import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recordedCopy,
  registerCopy,
  type RegisterResult,
  type RuntimeCopy,
  type RuntimeLog,
} from "./runtime-record.js";
import { compareVersions } from "./version-compare.js";

// The newest-copy rule for the terminal command and the hosts: an old command
// hands off to a newer recorded copy, and every copy that runs records itself.
// Like `runtime-record.ts`, it imports no config.

export const ommsDir = (home = homedir()): string => join(home, ".omms");

/** The package folder of the running copy, found from source or `dist/`. */
export function ownPackageRoot(from = import.meta.url): string | null {
  let dir = dirname(fileURLToPath(from));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === "om-memory-system") return dir;
    } catch {
      /* Try the parent. */
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Log a code through the shared logger. A host calls this after its config is loaded. */
const logCode: RuntimeLog = (code, data) => {
  void import("./logger.js")
    .then(({ log }) => log("Runtime record", { code, ...data }))
    .catch(() => {});
};

/**
 * Record the running copy when it is the newest. A failure is logged with a
 * code and never thrown, so it cannot stop a session or a command.
 */
export function registerOwnCopy(
  options: { dir?: string; root?: string | null; log?: RuntimeLog } = {}
): RegisterResult {
  const root = options.root === undefined ? ownPackageRoot() : options.root;
  if (!root) return "skipped";
  // Tests set this so that starting the real CLI never writes the developer's real record.
  if (options.dir === undefined && process.env.OMMS_DISABLE_RUNTIME_RECORD === "1")
    return "skipped";
  try {
    return registerCopy({ dir: options.dir ?? ommsDir(), root, log: options.log ?? logCode });
  } catch {
    return "failed";
  }
}

/**
 * Run the child and resolve to its exit code, or null when it could not start.
 * Standard input, output, and error flow through.
 */
function spawnCopy(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = nodeSpawn(command, args, { stdio: "inherit", env });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export interface HandoffOptions {
  dir?: string;
  ownRoot?: string | null;
  ownVersion?: string;
  env?: NodeJS.ProcessEnv;
  log?: RuntimeLog;
  /** Injected so tests run no process. Resolves to the exit code, or null when the copy cannot start. */
  spawn?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<number | null>;
}

/** The recorded copy this command must hand off to, or null. */
export function handoffTarget(
  options: HandoffOptions & { ownVersion: string }
): RuntimeCopy | null {
  const env = options.env ?? process.env;
  if (env.OMMS_NO_HANDOFF === "1" || env.OMMS_HANDED_OFF) return null;
  const copy = recordedCopy(options.dir ?? ommsDir(), options.log ?? logCode);
  if (!copy || copy.root === options.ownRoot) return null;
  return (compareVersions(copy.version, options.ownVersion) ?? 0) > 0 ? copy : null;
}

/**
 * The first step of the `om-memory-system` command. When the record names a
 * newer valid copy, run that copy's command with the same arguments and return
 * its exit code. Otherwise record this copy and return null, and the command
 * continues with its own code. `OMMS_HANDED_OFF` stops a loop when two records disagree.
 */
export async function handOffOrRegister(
  argv: string[],
  options: HandoffOptions = {}
): Promise<number | null> {
  const ownRoot = options.ownRoot === undefined ? ownPackageRoot() : options.ownRoot;
  let ownVersion = options.ownVersion;
  if (ownVersion === undefined) {
    const { packageVersion } = await import("./package-version.js");
    ownVersion = packageVersion();
  }
  const target = handoffTarget({ ...options, ownRoot, ownVersion });
  if (target) {
    const run = options.spawn ?? spawnCopy;
    const code = await run(
      process.execPath,
      [join(target.root, "dist", "cli", "index.js"), ...argv],
      { ...(options.env ?? process.env), OMMS_HANDED_OFF: "1" }
    );
    if (code !== null) return code;
  }
  registerOwnCopy({ dir: options.dir, root: ownRoot, log: options.log });
  return null;
}

/** The version of the newest valid recorded copy, or null. This is the version a launcher start runs. */
export function newestRecordedVersion(
  options: { dir?: string; log?: RuntimeLog } = {}
): string | null {
  return recordedCopy(options.dir ?? ommsDir(), options.log ?? logCode)?.version ?? null;
}

/** What `ensureWebApp` needs to replace an older running web app. */
export interface ReplaceOlder {
  version: string;
  headers: Record<string, string>;
}

/** The browser password settings a web app request needs, as `CONFIG` holds them. */
export interface BasicAuthSettings {
  webServerAuthPassword?: string;
  webServerAuthUsername?: string;
}

/**
 * Headers for the version lookup and the step-aside request. They carry the local
 * token, and Basic Auth when a browser password is set: the web server checks Basic
 * Auth first and refuses every other API request without it.
 */
export async function replaceHeaders(
  token: string,
  settings: BasicAuthSettings = {}
): Promise<Record<string, string>> {
  const { AUTH_HEADER } = await import("./auth-token.js");
  const headers: Record<string, string> = { [AUTH_HEADER]: token };
  const password = (settings.webServerAuthPassword ?? "").trim();
  if (!password) return headers;
  const { WebAuth } = await import("./web-auth.js");
  const { username } = new WebAuth({
    password,
    username: settings.webServerAuthUsername,
  }).getConfig();
  headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  return headers;
}

/**
 * For a host start: record this copy, then name the version a running web app
 * must reach. A web app older than it is asked to step aside. Without a
 * recorded copy there is no target, so any running web app is used.
 */
export async function hostReplaceOlder(
  settings: BasicAuthSettings = {}
): Promise<ReplaceOlder | undefined> {
  registerOwnCopy();
  const version = newestRecordedVersion();
  if (!version) return undefined;
  const { getOrCreateAuthToken } = await import("./auth-token.js");
  // The web app runs on this machine, so the local token file is enough.
  return { version, headers: await replaceHeaders(getOrCreateAuthToken(), settings) };
}
