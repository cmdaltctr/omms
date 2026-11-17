import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Fake `opencode`, `pi` and `claude` programs for `setup` and `doctor` tests.
// Each one is a script run by this test runtime's own binary, so it needs no
// `PATH` and never reaches a real host. Each call is appended to `calls.log`.
// Install commands change the scratch state the way the real host would.

export type FakeHost = "opencode" | "pi" | "claude";

export interface FakeHostOptions {
  version?: string;
  /** Exit 1 with this text on standard error for the install command. */
  failInstall?: string;
}

const SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const name = path.basename(__filename, ".js");
const options = JSON.parse(fs.readFileSync(path.join(__dirname, name + ".json"), "utf8"));
const args = process.argv.slice(2);
const key = args.join(" ");
fs.appendFileSync(path.join(__dirname, "calls.log"), name + " " + key + "\n");
const state = (file) => path.join(__dirname, name + "-" + file);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fail = () => {
  process.stderr.write(options.failInstall + "\n");
  process.exit(1);
};
if (key === "--version") {
  console.log(name + " " + options.version);
  process.exit(0);
}
if (name === "opencode" && key === "plugin add om-memory-system") {
  if (options.failInstall) fail();
  const folder = path.join(process.env.XDG_CONFIG_HOME, "opencode");
  write(path.join(folder, "opencode.json"), JSON.stringify({ plugins: ["om-memory-system"] }));
  console.log("installed and added " + folder);
  process.exit(0);
}
if (name === "pi" && key === "install npm:om-memory-system") {
  if (options.failInstall) fail();
  write(path.join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ packages: ["npm:om-memory-system"] }));
  process.exit(0);
}
if (name === "claude") {
  if (key === "plugin list") {
    console.log(fs.existsSync(state("installed")) ? "  ❯ omms@omms" : "No plugins installed");
    process.exit(0);
  }
  if (key === "plugin marketplace list") {
    console.log(fs.existsSync(state("marketplace")) ? "  ❯ omms" : "No marketplaces configured");
    process.exit(0);
  }
  if (key === "plugin marketplace add https://github.com/cmdaltctr/omms.git") {
    write(state("marketplace"), "yes");
    process.exit(0);
  }
  if (key === "plugin install omms@omms") {
    if (options.failInstall) fail();
    write(state("installed"), "yes");
    process.exit(0);
  }
}
process.stderr.write("fake " + name + ": unknown command " + key + "\n");
process.exit(2);
`;

/** Writes one fake host into `bin`. */
export function writeFakeHost(bin: string, name: FakeHost, options: FakeHostOptions = {}): void {
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, `${name}.js`), SCRIPT);
  writeFileSync(join(bin, `${name}.json`), JSON.stringify({ version: "9.9.9", ...options }));
  const runtime = process.execPath;
  if (process.platform === "win32") {
    writeFileSync(join(bin, `${name}.cmd`), `@"${runtime}" "%~dp0${name}.js" %*\r\n`);
  } else {
    const launcher = join(bin, name);
    writeFileSync(launcher, `#!/bin/sh\nexec "${runtime}" "${join(bin, `${name}.js`)}" "$@"\n`);
    chmodSync(launcher, 0o755);
  }
}

/** Every recorded call, one `name args` string each. */
export function fakeCalls(bin: string): string[] {
  const log = join(bin, "calls.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
}

/** Calls other than `--version` and the read-only list commands. */
export function changingCalls(bin: string): string[] {
  return fakeCalls(bin).filter(
    (call) => !/ (--version|plugin list|plugin marketplace list)$/.test(call)
  );
}

/** An environment that reaches only the scratch folders. */
export function scratchEnv(root: string, bin: string): Record<string, string> {
  return {
    PATH: bin,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    PI_CODING_AGENT_DIR: join(root, "pi"),
    ...(process.platform === "win32"
      ? { PATHEXT: ".CMD", SYSTEMROOT: process.env.SYSTEMROOT ?? "C:\\Windows" }
      : {}),
  };
}
