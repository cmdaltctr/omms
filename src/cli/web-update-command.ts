import { compareVersions } from "../services/version-compare.js";
import type { InstallResult } from "../services/web-update.js";

// `om-memory-system web update`: bring the global install to npm `latest`, then
// replace every standalone web app with one fresh web app on the newest copy.
// No process is killed: each web app stops itself after a request.

/** How long the command waits for the fresh web app to answer. */
export const FRESH_WAIT_MS = 15_000;
const POLL_MS = 250;
const REQUEST_TIMEOUT_MS = 2_000;

export interface WebUpdateCommandDeps {
  url: string;
  /** The local token header; the web app runs on this machine. */
  headers: Record<string, string>;
  /** The version this command runs as, the newest copy after the hand-off. */
  version: string;
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** npm `latest`, or null when the registry does not answer. */
  latest: () => Promise<string | null>;
  /** The global install's version from its `package.json`, or null. */
  globalVersion: () => string | null;
  install: (target: string) => Promise<InstallResult>;
  loginItemInstalled: () => boolean;
  /** Restart the login item through the service manager. False when it cannot. */
  restartLoginItem: () => boolean;
  /** Start a detached web app through the launcher. False when there is nothing to start. */
  startDetached: () => boolean;
  writeStartLock: () => void;
  removeStartLock: () => void;
  writeRetireMarker: (before: number) => void;
  print: (line: string) => void;
  log: (message: string, data: Record<string, unknown>) => void;
}

interface Owner {
  instance: string;
  version: string | null;
}

/** The web app on the port, or null when none answers. */
async function readOwner(deps: WebUpdateCommandDeps): Promise<Owner | null> {
  let instance: string;
  try {
    // Health skips basic auth, so the command finds a web app with basic auth on.
    const health = await deps.fetchFn(`${deps.url}/api/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await health.json()) as { instance?: unknown };
    if (!health.ok || typeof body.instance !== "string") return null;
    instance = body.instance;
  } catch {
    return null;
  }
  try {
    const response = await deps.fetchFn(`${deps.url}/api/web/status`, {
      headers: deps.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json()) as { version?: unknown };
    return {
      instance,
      version: response.ok && typeof body.version === "string" ? body.version : null,
    };
  } catch {
    return { instance, version: null };
  }
}

/** Ask the web app on the port to step aside for a replace. True when it agrees. */
async function stepAside(deps: WebUpdateCommandDeps): Promise<boolean> {
  try {
    const reply = await deps.fetchFn(`${deps.url}/api/web/step-aside`, {
      method: "POST",
      headers: { ...deps.headers, "content-type": "application/json" },
      body: JSON.stringify({ version: deps.version, replace: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return reply.status === 202;
  } catch {
    return false;
  }
}

/** Run `web update`. Returns the exit code. */
export async function runWebUpdate(deps: WebUpdateCommandDeps): Promise<number> {
  const began = deps.now();
  const record: Record<string, unknown> = { ownVersion: deps.version };
  const finish = (exitCode: number, outcome: string, code: string | null = null) => {
    deps.log("Web app update command", {
      ...record,
      outcome,
      code,
      durationMs: deps.now() - began,
    });
    return exitCode;
  };

  // 1. The global install.
  const latest = await deps.latest();
  const before = deps.globalVersion();
  Object.assign(record, { latest, globalBefore: before });
  if (latest === null) {
    record.npm = "unreachable";
    deps.print("Could not check npm for a release. Replacing the web app anyway.");
  } else if (before === null || (compareVersions(before, latest) ?? 0) < 0) {
    record.npm = "ran";
    deps.print(`Installing om-memory-system@${latest} globally (was ${before ?? "not installed"})`);
    const { code } = await deps.install(latest);
    const after = deps.globalVersion();
    record.globalAfter = after;
    const failure = code ?? (after === latest ? null : "version-mismatch");
    if (failure) {
      deps.print(
        `Global install failed (${failure}). The web app keeps running. Run: npm i -g om-memory-system@${latest}`
      );
      return finish(1, "install-failed", failure);
    }
    deps.print(`Global install: ${latest}`);
  } else {
    record.npm = "skipped";
    deps.print(`Global install is up to date (${before}).`);
  }

  // 2. Replace every standalone web app. Hosts wait while no web app serves.
  deps.writeStartLock();
  try {
    deps.writeRetireMarker(deps.now());
    const owner = await readOwner(deps);
    record.oldOwner = owner?.version ?? null;
    // A web app before `replace` existed ignores the flag and steps aside only for a newer caller.
    if (owner && !(await stepAside(deps))) {
      const name = owner.version ? `OMMS ${owner.version}` : "Another web app";
      deps.print(
        `${name} holds ${deps.url} and cannot hand it over. Stop that web app (Stop in its power menu, Ctrl+C in its terminal, or quit the session that runs it), then run om-memory-system web update again.`
      );
      return finish(1, "stuck", "stuck");
    }

    // 3. Start one fresh web app on the newest copy.
    const viaLoginItem = deps.loginItemInstalled() && deps.restartLoginItem();
    record.start = viaLoginItem ? "login-item" : "launcher";
    if (!viaLoginItem && !deps.startDetached()) {
      deps.print("No OMMS copy to start. Run om-memory-system web to start the web app.");
      return finish(1, "no-copy", "no-copy");
    }

    // 4. Wait for a web app that is not the old one.
    const askedAside = new Set(owner ? [owner.instance] : []);
    const deadline = deps.now() + FRESH_WAIT_MS;
    while (deps.now() < deadline) {
      const current = await readOwner(deps);
      if (current && !askedAside.has(current.instance)) {
        const older =
          current.version !== null && (compareVersions(current.version, deps.version) ?? 0) < 0;
        if (!older) {
          record.served = current.version;
          deps.print(
            current.version
              ? `OMMS web app: ${deps.url} (version ${current.version})`
              : `OMMS web app: ${deps.url}`
          );
          return finish(0, "replaced");
        }
        // An older web app that waited for the port took it before the fresh one.
        askedAside.add(current.instance);
        await stepAside(deps);
      }
      await deps.sleep(POLL_MS);
    }
    deps.print(
      `No web app answered on ${deps.url} within ${FRESH_WAIT_MS / 1000} seconds. Run om-memory-system web status.`
    );
    return finish(1, "no-answer", "no-answer");
  } finally {
    deps.removeStartLock();
  }
}

/** The real network, npm, login item, and launcher. */
export async function productionWebUpdateDeps(options: {
  url: string;
  home: string;
  autostart: import("../services/web-autostart.js").WebAutostartOptions;
}): Promise<WebUpdateCommandDeps> {
  const [
    { spawn },
    { existsSync },
    { join },
    { AUTH_HEADER, getOrCreateAuthToken },
    { packageVersion },
    { latestNpmVersion },
    { globalCommandVersion },
    { runGlobalInstall },
    { nodeInstallDeps },
    { restartWebAutostart, webAutostartStatus },
    { launcherPath, recordedCopy },
    { ommsDir },
    { nodeLockFs, removeStartLockFor, startLockPath },
    { writeRetireMarker },
    { log },
  ] = await Promise.all([
    import("node:child_process"),
    import("node:fs"),
    import("node:path"),
    import("../services/auth-token.js"),
    import("../services/package-version.js"),
    import("../services/update-check.js"),
    import("../services/global-version.js"),
    import("../services/web-update.js"),
    import("../services/web-update-runtime.js"),
    import("../services/web-autostart.js"),
    import("../services/runtime-record.js"),
    import("../services/runtime-handoff.js"),
    import("../services/web-ensure.js"),
    import("../services/web-retire.js"),
    import("../services/logger.js"),
  ]);
  const dir = ommsDir(options.home);
  const lockPath = startLockPath(options.home);
  return {
    url: options.url,
    headers: { [AUTH_HEADER]: getOrCreateAuthToken() },
    version: packageVersion(),
    fetchFn: fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    latest: () => latestNpmVersion(fetch),
    // npm installs beside this Node.js, so read that install, not the first command on PATH.
    globalVersion: () => globalCommandVersion({ find: () => null }).version,
    install: (target) => runGlobalInstall(nodeInstallDeps(), target),
    loginItemInstalled: () => webAutostartStatus(options.autostart).state === "installed",
    restartLoginItem: () => restartWebAutostart(options.autostart),
    startDetached: () => {
      // The launcher picks the newest copy, the global install beside this Node.js included.
      const launcher = launcherPath(dir);
      const copy = recordedCopy(dir);
      const script = existsSync(launcher)
        ? launcher
        : copy
          ? join(copy.root, "dist", "cli", "index.js")
          : null;
      if (!script) return false;
      try {
        spawn(process.execPath, [script, "web"], {
          detached: true,
          stdio: "ignore",
          cwd: options.home,
          windowsHide: true,
        }).unref();
        return true;
      } catch {
        return false;
      }
    },
    writeStartLock: () =>
      nodeLockFs.replace(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() })),
    removeStartLock: () => removeStartLockFor(process.pid, lockPath),
    writeRetireMarker: (before) => writeRetireMarker(before, { home: options.home }),
    print: (line) => console.log(line),
    log,
  };
}
