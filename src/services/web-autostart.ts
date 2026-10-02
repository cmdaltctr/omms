import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  accessSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  constants,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import {
  copyVersion,
  ensureLauncher,
  launcherPath,
  recordedCopy,
  type RuntimeLog,
} from "./runtime-record.js";
import { compareVersions } from "./version-compare.js";

const MARKER = "OMMS login item";
const NAME = "io.github.cmdaltctr.omms.web";
type State = "installed" | "not-installed" | "unsupported" | "no-runtime" | "no-package";
export type WebAutostartStatus = {
  state: State;
  path?: string;
  runtime?: string;
  /** The copy the launcher starts now: the newest of the record, the global install, and this copy. */
  packagePath?: string;
  /** The fixed launcher the item runs, `~/.omms/bin/omms-launch.mjs`. */
  launcher?: string;
  command?: string;
};
export interface WebAutostartOptions {
  home?: string;
  platform?: string;
  runtime?: string | null;
  packageRoot?: string | null;
  /** The running copy, a launcher source when the chosen copy has none. Defaults to `packageRoot`, then this copy. */
  ownRoot?: string | null;
  systemctlAvailable?: boolean;
  run?: (command: string, args: string[]) => void;
  start?: boolean;
}

function executable(name: string): string | null {
  for (const part of (process.env.PATH ?? "").split(delimiter)) {
    if (!part) continue;
    const path = resolve(part, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      /* Search the next directory. */
    }
  }
  return null;
}

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** A Homebrew upgrade deletes the versioned Cellar folder, so use a link that survives it. */
function stableRuntime(path: string): string {
  const match = /^(.*)[\\/]Cellar[\\/]([^\\/]+)[\\/][^\\/]+[\\/]bin[\\/]([^\\/]+)$/.exec(path);
  const [, prefix, formula, name] = match ?? [];
  if (!prefix || !formula || !name) return path;
  const linked = join(prefix, "bin", name);
  if (sameFile(linked, path)) return linked;
  const opt = join(prefix, "opt", formula, "bin", name);
  return sameFile(opt, path) ? opt : path;
}

/** OpenCode's executable is not a JavaScript runtime. */
export function resolveWebRuntime(
  execPath = process.execPath,
  platform = process.platform
): string | null {
  const name = basename(execPath).toLowerCase();
  if (["node", "bun", "node.exe", "bun.exe"].includes(name)) return stableRuntime(execPath);
  const suffix = platform === "win32" ? ".exe" : "";
  const found = executable(`node${suffix}`) ?? executable(`bun${suffix}`);
  return found && stableRuntime(found);
}

function packageRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const file = join(dir, "package.json");
    try {
      if (JSON.parse(readFileSync(file, "utf8")).name === "om-memory-system") return dir;
    } catch {
      /* Try the parent. */
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The newest valid OMMS copy among the candidates. On equal versions the first
 * wins, so a host's cached copy goes last. This is the copy the launcher starts,
 * and it matches the launcher's own choice.
 */
export function preferredPackageRoot(
  candidates: readonly (string | null | undefined)[]
): string | null {
  let best: { root: string; version: string } | null = null;
  for (const root of candidates) {
    if (!root) continue;
    const version = copyVersion(root);
    if (!version) continue;
    if (!best || (compareVersions(version, best.version) ?? 0) > 0) best = { root, version };
  }
  return best?.root ?? null;
}

function globalPackageRoot(runtime: string | null, platform: string): string | null {
  if (!runtime) return null;
  const prefix = dirname(dirname(runtime));
  return platform === "win32"
    ? join(dirname(runtime), "node_modules", "om-memory-system")
    : join(prefix, "lib", "node_modules", "om-memory-system");
}

function itemPath(home: string, platform: string): string | null {
  if (platform === "darwin") return join(home, "Library", "LaunchAgents", `${NAME}.plist`);
  if (platform === "linux") return join(home, ".config", "systemd", "user", "omms-web.service");
  if (platform === "win32")
    return join(
      home,
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
      "omms-web.cmd"
    );
  return null;
}

function details(options: WebAutostartOptions) {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const path = itemPath(home, platform);
  const runtime = options.runtime === undefined ? resolveWebRuntime() : options.runtime;
  const dir = join(home, ".omms");
  const own =
    options.ownRoot !== undefined
      ? options.ownRoot
      : options.packageRoot !== undefined
        ? options.packageRoot
        : packageRoot();
  const recorded = recordedCopy(dir, logCode)?.root ?? null;
  const root =
    options.packageRoot === undefined
      ? preferredPackageRoot([recorded, globalPackageRoot(runtime ?? null, platform), own])
      : options.packageRoot;
  const supported =
    platform !== "linux" || (options.systemctlAvailable ?? Boolean(executable("systemctl")));
  return { home, platform, path, runtime, root, own, recorded, dir, supported };
}

const logCode: RuntimeLog = (code, data) => log("Runtime record", { code, ...data });

const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const systemd = (value: string) => `"${value.replaceAll("%", "%%").replaceAll('"', '\\"')}"`;
const windows = (value: string) => `"${value.replaceAll("%", "%%")}"`;

function itemContent(platform: string, runtime: string, launcher: string): string {
  if (platform === "darwin")
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<!-- ${MARKER} -->
<key>Label</key><string>${NAME}</string>
<key>ProgramArguments</key><array><string>${xml(runtime)}</string><string>${xml(launcher)}</string><string>web</string><string>--login-item</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
  if (platform === "linux")
    return `# ${MARKER}
[Unit]\nDescription=OMMS web app\n[Service]\nType=simple\nExecStart=${systemd(runtime)} ${systemd(launcher)} web --login-item\n[Install]\nWantedBy=default.target\n`;
  return `@echo off\r\nrem ${MARKER}\r\nstart "" /min ${windows(runtime)} ${windows(launcher)} web --login-item\r\n`;
}

function owned(path: string): boolean {
  return readFileSync(path, "utf8").includes(MARKER);
}

function runCommand(options: WebAutostartOptions, home: string, command: string, args: string[]) {
  if (options.run) options.run(command, args);
  else execFileSync(command, args, { cwd: home, stdio: "ignore", timeout: 5_000 });
}

/** Read the login item's state without changing any system files. */
export function webAutostartStatus(options: WebAutostartOptions = {}): WebAutostartStatus {
  const { path, runtime, root, dir, supported } = details(options);
  if (!path || !supported) return { state: "unsupported" };
  if (!runtime) return { state: "no-runtime", path };
  if (!root) return { state: "no-package", path, runtime };
  const launcher = launcherPath(dir);
  if (!existsSync(path))
    return { state: "not-installed", path, runtime, packagePath: root, launcher };
  if (!owned(path)) throw new Error("Login item at the OMMS path is not owned by OMMS");
  return {
    state: "installed",
    path,
    runtime,
    packagePath: root,
    launcher,
    command: readFileSync(path, "utf8"),
  };
}

/** Install or update only the fixed-name OMMS item. `start` launches it now. */
export function installWebAutostart(options: WebAutostartOptions = {}): WebAutostartStatus {
  const status = webAutostartStatus(options);
  if (
    status.state === "unsupported" ||
    status.state === "no-runtime" ||
    status.state === "no-package"
  )
    return status;
  const { home, platform, path, runtime, root, own, recorded, dir } = details(options);
  // The item runs a fixed launcher, so the launcher must exist before the item does.
  if (!ensureLauncher({ dir, sources: [root, own, recorded], log: logCode }))
    return { state: "no-package", path: path!, runtime: runtime! };
  const file = path!;
  const content = itemContent(platform, runtime!, launcherPath(dir));
  mkdirSync(dirname(file), { recursive: true });
  const changed = !existsSync(file) || readFileSync(file, "utf8") !== content;
  if (changed) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, content, { mode: 0o600 });
      renameSync(temp, file);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
  if (platform === "linux") {
    if (changed) runCommand(options, home, "systemctl", ["--user", "daemon-reload"]);
    // Re-enable even if the unit file is unchanged; the user service may have been disabled.
    runCommand(options, home, "systemctl", ["--user", "enable", "omms-web.service"]);
    if (options.start)
      runCommand(options, home, "systemctl", ["--user", "start", "omms-web.service"]);
  }
  if (platform === "darwin" && options.start) {
    const domain = `gui/${process.getuid?.() ?? 0}`;
    try {
      runCommand(options, home, "launchctl", ["bootout", domain, file]);
    } catch {
      /* Not loaded. */
    }
    runCommand(options, home, "launchctl", ["bootstrap", domain, file]);
  }
  return webAutostartStatus(options);
}

/** Remove only an item carrying the OMMS marker. */
export function removeWebAutostart(options: WebAutostartOptions = {}): WebAutostartStatus {
  const { home, platform, path, supported } = details(options);
  if (!path) return { state: "unsupported" };
  if (!existsSync(path)) return { state: "not-installed", path };
  if (!owned(path)) throw new Error("Login item at the OMMS path is not owned by OMMS");
  if (platform === "darwin" && options.start) {
    try {
      runCommand(options, home, "launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, path]);
    } catch {
      /* A registered item may not be loaded. */
    }
  }
  if (platform === "linux" && supported) {
    runCommand(options, home, "systemctl", [
      "--user",
      "disable",
      ...(options.start ? ["--now"] : []),
      "omms-web.service",
    ]);
  }
  unlinkSync(path);
  return { state: "not-installed", path };
}

/**
 * Restart the login item through the platform service manager. A detached child
 * of the item would die with its launchd job or systemd control group, so the
 * service manager does the restart. Returns false when it cannot.
 */
export function restartWebAutostart(options: WebAutostartOptions = {}): boolean {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  try {
    if (platform === "darwin") {
      runCommand(options, home, "launchctl", [
        "kickstart",
        "-k",
        `gui/${process.getuid?.() ?? 0}/${NAME}`,
      ]);
    } else if (platform === "linux") {
      runCommand(options, home, "systemctl", ["--user", "restart", "omms-web.service"]);
    } else {
      return false;
    }
    return true;
  } catch (error) {
    log("OMMS login item restart failed", {
      code: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

/** Host start checks the global settings. A failed item cannot block a session. */
export function reconcileWebAutostart(
  config: Pick<typeof CONFIG, "webServerAutoStart" | "webServerEnabled"> = CONFIG,
  options: WebAutostartOptions = {}
): void {
  if (process.env.OMMS_DISABLE_WEB_AUTOSTART === "1") return;
  try {
    if (config.webServerAutoStart && config.webServerEnabled) installWebAutostart(options);
    else removeWebAutostart(options);
  } catch (error) {
    log("OMMS login item reconciliation failed", {
      code: error instanceof Error ? error.name : "unknown",
    });
  }
}
