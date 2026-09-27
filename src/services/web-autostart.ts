import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  accessSync,
  existsSync,
  mkdirSync,
  readFileSync,
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

const MARKER = "OMMS login item";
const NAME = "io.github.cmdaltctr.omms.web";
type State = "installed" | "not-installed" | "unsupported" | "no-runtime" | "no-package";
export type WebAutostartStatus = {
  state: State;
  path?: string;
  runtime?: string;
  packagePath?: string;
  command?: string;
};
export interface WebAutostartOptions {
  home?: string;
  platform?: string;
  runtime?: string | null;
  packageRoot?: string | null;
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

/** OpenCode's executable is not a JavaScript runtime. */
export function resolveWebRuntime(
  execPath = process.execPath,
  platform = process.platform
): string | null {
  const name = basename(execPath).toLowerCase();
  if (["node", "bun", "node.exe", "bun.exe"].includes(name)) return execPath;
  const suffix = platform === "win32" ? ".exe" : "";
  return executable(`node${suffix}`) ?? executable(`bun${suffix}`);
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
  const root = options.packageRoot === undefined ? packageRoot() : options.packageRoot;
  const supported =
    platform !== "linux" || (options.systemctlAvailable ?? Boolean(executable("systemctl")));
  return { home, platform, path, runtime, root, supported };
}

const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const systemd = (value: string) => `"${value.replaceAll("%", "%%").replaceAll('"', '\\"')}"`;
const windows = (value: string) => `"${value.replaceAll("%", "%%")}"`;

function itemContent(platform: string, runtime: string, cli: string): string {
  if (platform === "darwin")
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<!-- ${MARKER} -->
<key>Label</key><string>${NAME}</string>
<key>ProgramArguments</key><array><string>${xml(runtime)}</string><string>${xml(cli)}</string><string>web</string><string>--login-item</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
  if (platform === "linux")
    return `# ${MARKER}
[Unit]\nDescription=OMMS web app\n[Service]\nType=simple\nExecStart=${systemd(runtime)} ${systemd(cli)} web --login-item\n[Install]\nWantedBy=default.target\n`;
  return `@echo off\r\nrem ${MARKER}\r\nstart "" /min ${windows(runtime)} ${windows(cli)} web --login-item\r\n`;
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
  const { path, runtime, root, supported } = details(options);
  if (!path || !supported) return { state: "unsupported" };
  if (!runtime) return { state: "no-runtime", path };
  if (!root) return { state: "no-package", path, runtime };
  if (!existsSync(path)) return { state: "not-installed", path, runtime, packagePath: root };
  if (!owned(path)) throw new Error("Login item at the OMMS path is not owned by OMMS");
  return {
    state: "installed",
    path,
    runtime,
    packagePath: root,
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
  const { home, platform, path, runtime, root } = details(options);
  const file = path!;
  const content = itemContent(platform, runtime!, join(root!, "dist", "cli", "index.js"));
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
