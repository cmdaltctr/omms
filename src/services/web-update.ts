import { posix, win32 } from "node:path";
import { availableUpdate, latestNpmVersion } from "./update-check.js";

// The web app's npm release check. It reads npm `latest` at start and then every
// 6 hours, and keeps the result in memory for `GET /api/web/status`. It imports
// no host adapter and no config, so tests pass every input.

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** An install that takes longer is stopped, and the web app keeps serving. */
export const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
/** Only a plain release reaches the npm arguments; the value comes from the registry. */
const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;
/** Enough of npm's error stream to find a code; the rest is dropped. */
const ERROR_TAIL_BYTES = 64 * 1024;

export type UpdateState = "idle" | "installing" | "restarting" | "failed";

/** The `update` field of `GET /api/web/status`. */
export interface UpdateStatus {
  /** The newer release on npm, or null. */
  available: string | null;
  state: UpdateState;
  /** The failure code while `state` is `failed`. */
  code: string | null;
  /** True when this web app can install the release itself. */
  canInstall: boolean;
}

export interface WebUpdateDeps {
  /** The running version. */
  version: string;
  /** False when `OMMS_DISABLE_UPDATE_CHECK` is `1`. */
  enabled: boolean;
  fetch: typeof fetch;
  setInterval: (callback: () => void, ms: number) => { unref?: () => void };
  log: (message: string, data: Record<string, unknown>) => void;
  /** The runtime of this web app; npm must sit beside it. */
  execPath: string;
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  spawn: (command: string, args: string[], options: { shell: boolean }) => InstallChild;
  /** The version of the global install after npm ran, or null. */
  globalVersion: () => string | null;
  /** False when no restart could serve the new copy, such as a missing launcher. Checked before npm runs. */
  canRestart: () => boolean;
  /** Stop npm and its children. On Windows the shell wrapper alone would leave npm running. */
  killTree: (child: InstallChild) => Promise<void>;
  /** Restart onto the newest copy. Returns a failure code when this web app keeps serving. */
  restart: () => Promise<string | undefined>;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

/** The parts of a child process the install runner uses. */
export interface InstallChild {
  pid?: number;
  stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "error", listener: () => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type InstallRequest = "accepted" | "no-update" | "cannot-install";

/** A failure code from npm's error stream. The text itself never leaves this function. */
export function npmFailureCode(errorText: string): string {
  if (/\b(EACCES|EPERM)\b/.test(errorText)) return "permission";
  if (/\b(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN)\b/.test(errorText)) return "network";
  return "npm-exit";
}

export class WebUpdate {
  private available: string | null = null;
  private state: UpdateState = "idle";
  private code: string | null = null;
  private started = false;

  constructor(private readonly deps: WebUpdateDeps) {}

  /** Check now, then every 6 hours. A second call does nothing. */
  start(): void {
    if (this.started || !this.deps.enabled) return;
    this.started = true;
    void this.check();
    this.deps.setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS).unref?.();
  }

  /** Read npm `latest`. A failed read keeps the last result. */
  async check(): Promise<void> {
    if (!this.deps.enabled) return;
    const latest = await latestNpmVersion(this.deps.fetch);
    if (latest === null) {
      this.deps.log("Web app update check failed", { code: "unreachable" });
      return;
    }
    this.available = availableUpdate(this.deps.version, latest);
  }

  /** The npm that installs into the prefix the launcher reads. */
  private npmPath(): string {
    // Path rules follow the target platform, not the machine that runs this code.
    const path = this.deps.platform === "win32" ? win32 : posix;
    const name = this.deps.platform === "win32" ? "npm.cmd" : "npm";
    return path.join(path.dirname(this.deps.execPath), name);
  }

  status(): UpdateStatus {
    return {
      available: this.available,
      state: this.state,
      code: this.code,
      canInstall: this.canInstall(),
    };
  }

  private canInstall(): boolean {
    return this.deps.exists(this.npmPath()) && this.deps.canRestart();
  }

  /** Start the install and the restart. A request while one runs joins it. */
  requestInstall(): InstallRequest {
    if (this.state === "installing" || this.state === "restarting") return "accepted";
    if (!this.available) return "no-update";
    if (!this.canInstall()) return "cannot-install";
    this.state = "installing";
    this.code = null;
    void this.install(this.available);
    return "accepted";
  }

  private async install(target: string): Promise<void> {
    const began = this.deps.now();
    const record = (outcome: string, code: string | null, exitCode?: number | null) =>
      this.deps.log("Web app update", {
        outcome,
        code,
        from: this.deps.version,
        to: target,
        exitCode,
        durationMs: this.deps.now() - began,
      });
    const fail = (code: string, exitCode?: number | null) => {
      this.state = "failed";
      this.code = code;
      record("failed", code, exitCode);
    };
    if (!PLAIN_VERSION.test(target)) return fail("bad-version");
    const { code, exitCode } = await this.runNpm(target);
    if (code) return fail(code, exitCode);
    if (this.deps.globalVersion() !== target) return fail("version-mismatch", exitCode);
    this.state = "restarting";
    record("installed", null, exitCode);
    const restartCode = await this.deps.restart();
    // The restart exits this process on success, so a return means it kept serving.
    if (restartCode) fail(restartCode);
    else this.state = "idle";
  }

  private runNpm(target: string): Promise<{ code: string | null; exitCode?: number | null }> {
    return new Promise((resolve) => {
      let child: InstallChild;
      try {
        // Windows runs `npm.cmd` only through a shell, which splits an unquoted path at a
        // space (`C:\\Program Files`). The arguments are fixed and the version is checked.
        const windows = this.deps.platform === "win32";
        const command = windows ? `"${this.npmPath()}"` : this.npmPath();
        child = this.deps.spawn(command, ["install", "-g", `om-memory-system@${target}`], {
          shell: windows,
        });
      } catch {
        resolve({ code: "spawn-error" });
        return;
      }
      let errorText = "";
      let done = false;
      const finish = (result: { code: string | null; exitCode?: number | null }) => {
        if (done) return;
        done = true;
        this.deps.clearTimeout(timer);
        resolve(result);
      };
      let timedOut = false;
      const timer = this.deps.setTimeout(() => {
        timedOut = true;
        // Keep the update running until npm has stopped, so nothing else touches the install.
        void this.deps
          .killTree(child)
          .catch(() => undefined)
          .then(() => finish({ code: "timeout" }));
      }, INSTALL_TIMEOUT_MS);
      child.stderr?.on("data", (chunk) => {
        errorText = (errorText + String(chunk)).slice(-ERROR_TAIL_BYTES);
      });
      child.on("error", () => finish({ code: "spawn-error" }));
      child.on("exit", (exitCode) => {
        // After a timeout the tree is still stopping; the timeout path reports it.
        if (timedOut) return;
        finish({ code: exitCode === 0 ? null : npmFailureCode(errorText), exitCode });
      });
    });
  }
}
