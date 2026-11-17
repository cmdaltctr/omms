import { afterEach, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launcherPath } from "../src/services/runtime-record.js";
import { installWebAutostart } from "../src/services/web-autostart.js";

// The login item's restart rule. launchd and systemd restart a web app that
// exits with an error, at most once every 30 seconds, and never one that exits
// with 0. Every file lives in a temp home; no launchctl or systemctl runs.

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function setup(platform: "darwin" | "linux" | "win32") {
  const home = mkdtempSync(join(tmpdir(), "omms-watchdog-"));
  homes.push(home);
  const root = join(home, "pkg");
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "dist", "cli", "index.js"), "");
  writeFileSync(join(root, "bin", "omms-launch.mjs"), "// launcher\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "om-memory-system", version: "6.5.0" })
  );
  const commands: string[] = [];
  const options = {
    home,
    platform,
    runtime: "/opt/node/bin/node",
    packageRoot: root,
    systemctlAvailable: true,
    run: (command: string, args: string[]) => void commands.push([command, ...args].join(" ")),
  };
  return { home, options, commands, launcher: launcherPath(join(home, ".omms")) };
}

it("writes a macOS item that restarts only after an unsuccessful exit, 30 seconds apart", () => {
  const f = setup("darwin");
  const text = readFileSync(installWebAutostart(f.options).path!, "utf8");
  expect(text).toContain(
    "<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer>"
  );
  expect(text).not.toContain("<key>KeepAlive</key><false/>");
  if (process.platform === "darwin") {
    // The system's own parser accepts the file.
    const lint = spawnSync("plutil", ["-lint", installWebAutostart(f.options).path!], {
      encoding: "utf8",
    });
    expect(lint.status).toBe(0);
  }
});

it("writes a Linux unit that restarts on failure 30 seconds later, at most 5 starts in 10 minutes", () => {
  const f = setup("linux");
  const text = readFileSync(installWebAutostart(f.options).path!, "utf8");
  // systemd reads the start limit only under [Unit].
  expect(text).toContain(
    "[Unit]\nDescription=OMMS web app\nStartLimitIntervalSec=600\nStartLimitBurst=6\n[Service]"
  );
  expect(text).toContain(
    `[Service]\nType=simple\nExecStart="/opt/node/bin/node" "${f.launcher}" web --login-item\nRestart=on-failure\nRestartSec=30\n`
  );
});

it("leaves the Windows startup item without a restart rule", () => {
  const f = setup("win32");
  const text = readFileSync(installWebAutostart(f.options).path!, "utf8");
  expect(text).toBe(
    `@echo off\r\nrem OMMS login item\r\nstart "" /min "/opt/node/bin/node" "${f.launcher}" web --login-item\r\n`
  );
});

/** The exact item text OMMS 6.5.0 wrote, before the restart rule. */
function oldItem(platform: "darwin" | "linux", launcher: string): string {
  if (platform === "darwin")
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<!-- OMMS login item -->
<key>Label</key><string>io.github.cmdaltctr.omms.web</string>
<key>ProgramArguments</key><array><string>/opt/node/bin/node</string><string>${launcher}</string><string>web</string><string>--login-item</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
  return `# OMMS login item
[Unit]\nDescription=OMMS web app\n[Service]\nType=simple\nExecStart="/opt/node/bin/node" "${launcher}" web --login-item\n[Install]\nWantedBy=default.target\n`;
}

for (const platform of ["darwin", "linux"] as const) {
  it(`rewrites a ${platform} item from an earlier version once, and a host start starts no web app`, () => {
    const f = setup(platform);
    // A host start runs the install step without `start`, as reconcileWebAutostart does.
    const path = installWebAutostart(f.options).path!;
    writeFileSync(path, oldItem(platform, f.launcher));
    f.commands.length = 0;
    installWebAutostart(f.options);
    const text = readFileSync(path, "utf8");
    expect(text).toContain(platform === "darwin" ? "SuccessfulExit" : "Restart=on-failure");
    // Linux reloads the unit, so the running service gets the rule; macOS reads it at the next login.
    expect(f.commands).toEqual(
      platform === "linux"
        ? ["systemctl --user daemon-reload", "systemctl --user enable omms-web.service"]
        : []
    );
    // A second host start finds the new text and changes nothing.
    f.commands.length = 0;
    installWebAutostart(f.options);
    expect(readFileSync(path, "utf8")).toBe(text);
    expect(f.commands).toEqual(
      platform === "linux" ? ["systemctl --user enable omms-web.service"] : []
    );
  });
}

it("clears the restart count when the user runs web install", () => {
  const f = setup("darwin");
  const starts = join(f.home, ".omms", "web-starts.json");
  mkdirSync(join(f.home, ".omms"), { recursive: true });
  writeFileSync(starts, JSON.stringify([1, 2, 3, 4, 5]));
  // A host start keeps the count.
  installWebAutostart(f.options);
  expect(existsSync(starts)).toBe(true);
  // `web install` passes `start: true`.
  installWebAutostart({ ...f.options, start: true });
  expect(existsSync(starts)).toBe(false);
});

it("clears systemd's start limit when the user runs web install on Linux", () => {
  const f = setup("linux");
  installWebAutostart({ ...f.options, start: true });
  // After 5 starts in 10 minutes systemd refuses a start until the count is reset.
  expect(f.commands.slice(-2)).toEqual([
    "systemctl --user reset-failed omms-web.service",
    "systemctl --user start omms-web.service",
  ]);
});
