#!/usr/bin/env node
// Runs the newest valid OMMS copy on the machine. It needs only Node.js and its
// built-in modules, so the Claude Code plugin (which has no `dist/`) and the
// login item can both run it.
//
//   node omms-launch.mjs [--at-least-own-version] <om-memory-system arguments>
//
// Candidates: the global install beside the running Node.js, the copy named in
// ~/.omms/runtime.json, and the copy that holds this file. On a tie the first wins. With
// `--at-least-own-version`, the version in the `package.json` beside this file is
// the minimum. When no candidate reaches it, the launcher runs
// `npx --yes om-memory-system@<that version>`.

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version) {
  const match = SEMVER.exec(String(version).trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

function comparePart(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * SemVer order, the same as `compareVersions` in `src/services/version-compare.ts`.
 * It cannot import that file, because the plugin has no `dist/`;
 * `tests/omms-launch.test.ts` keeps the two the same. Returns null when either
 * version cannot be parsed.
 */
export function compareVersions(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    const diff = left.core[i] - right.core[i];
    if (diff) return Math.sign(diff);
  }
  if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const diff = comparePart(l, r);
    if (diff) return diff;
  }
  return 0;
}

/** True when a package folder named `name` with a `package.json` resolves from `from`, the way Node.js looks. */
function resolves(from, name) {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", name, "package.json"))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/** The first package folder in `<root>/node_modules` without a `package.json`, or null. */
function emptyPackageFolder(root) {
  const modules = join(root, "node_modules");
  let names;
  try {
    names = readdirSync(modules).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (!name.startsWith("@")) {
      if (!existsSync(join(modules, name, "package.json"))) return name;
      continue;
    }
    let scoped = [];
    try {
      scoped = readdirSync(join(modules, name)).sort();
    } catch {
      /* A file, not a scope folder. */
    }
    for (const child of scoped)
      if (!existsSync(join(modules, name, child, "package.json"))) return `${name}/${child}`;
  }
  return null;
}

/**
 * The first problem of a copy folder, or null when it is complete. The same rule
 * as `src/services/install-check.ts`; tests/install-check.test.ts runs both.
 */
export function installProblem(root) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    return "package.json";
  }
  if (!existsSync(join(root, "dist", "cli", "index.js"))) return "dist/cli/index.js";
  const optional = pkg.optionalDependencies ?? {};
  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    if (!(name in optional) && !resolves(root, name)) return name;
  }
  return emptyPackageFolder(root);
}

/**
 * A valid copy has the package name, a comparable version, `dist/cli/index.js`,
 * and every dependency. `problems` collects the missing part of an OMMS copy that
 * is not valid, so the launcher can name it.
 */
function readCopy(root, problems) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.name !== "om-memory-system" || typeof pkg.version !== "string") return null;
    if (compareVersions(pkg.version, pkg.version) === null) return null;
    const problem = installProblem(root);
    if (problem) problems?.push(problem);
    return problem ? null : { root, version: pkg.version };
  } catch {
    return null;
  }
}

/** The package folder of a global npm install beside the given Node.js binary. */
export function globalPackageRoot(execPath, platform = process.platform) {
  if (!execPath) return null;
  if (platform === "win32") return join(dirname(execPath), "node_modules", "om-memory-system");
  return join(dirname(dirname(execPath)), "lib", "node_modules", "om-memory-system");
}

/**
 * Every place a global install can be for this Node.js binary. Homebrew runs Node
 * from a versioned `Cellar/node/<version>` folder, but npm installs under the
 * prefix above `Cellar`, so that prefix counts too.
 */
export function globalPackageRoots(execPath, platform = process.platform) {
  const direct = globalPackageRoot(execPath, platform);
  if (!direct) return [];
  const brew = /^(.*)[\\/]Cellar[\\/][^\\/]+[\\/][^\\/]+[\\/]bin[\\/][^\\/]+$/.exec(execPath);
  return brew ? [direct, join(brew[1], "lib", "node_modules", "om-memory-system")] : [direct];
}

/**
 * The global installs, the record's copy, and the own copy, in that order. Invalid
 * ones are null. On a tie the global install wins, so a host's cache copy does not
 * keep serving after the global install catches up.
 */
export function findCandidates({ dir, execPath, ownRoot }, problems) {
  let recorded = null;
  try {
    const record = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
    if (record && typeof record.root === "string") recorded = readCopy(record.root, problems);
  } catch {
    /* No record, or an unreadable one: the other candidates still work. */
  }
  const globals = globalPackageRoots(execPath).map((root) => readCopy(root, problems));
  return [...globals, recorded, ownRoot ? readCopy(ownRoot, problems) : null];
}

/**
 * The newest candidate. On a tie the first one wins. With `minVersion`, a newest
 * candidate that is older asks for `npx` at that version instead.
 */
export function chooseCopy(candidates, minVersion) {
  let best = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!best || (compareVersions(candidate.version, best.version) ?? 0) > 0) best = candidate;
  }
  const wanted = minVersion && parse(minVersion) ? minVersion : null;
  if (wanted && (!best || (compareVersions(best.version, wanted) ?? 0) < 0))
    return { kind: "npx", version: wanted };
  return best ? { kind: "copy", copy: best } : { kind: "none" };
}

export function parseLauncherArgs(argv) {
  return argv[0] === "--at-least-own-version"
    ? { atLeastOwnVersion: true, args: argv.slice(1) }
    : { atLeastOwnVersion: false, args: [...argv] };
}

/** Run a command with inherited input and output, and resolve to its exit code. */
function spawnInherit(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// The login item's restart limit. launchd and systemd restart a web app that
// exits with an error. The launcher counts those failed starts in
// `web-starts.json`; after 5 within 10 minutes it exits with 0, which neither
// restarts, so a broken copy cannot loop. Restart and an update end the launcher
// with a signal or exit 0, so they never count.
export const RESTART_LIMIT = 5;
export const RESTART_WINDOW_MS = 10 * 60 * 1000;

/** The failed starts within the window. A missing or unreadable file is none. */
function recentFailures(file, now) {
  try {
    const list = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(list)
      ? list.filter((at) => typeof at === "number" && now - at < RESTART_WINDOW_MS)
      : [];
  } catch {
    return [];
  }
}

/** One line in the OMMS log, in the logger's shape. A failed write never stops a start. */
function appendLog(dir) {
  return (data) => {
    try {
      const file = process.env.OMMS_LOG_FILE || join(dir, "omms.log");
      appendFileSync(
        file,
        `[${new Date().toISOString()}] ERROR Web login item: ${JSON.stringify(data)}\n`
      );
    } catch {
      /* No log folder: the exit code still tells the supervisor. */
    }
  };
}

/** The version in the `package.json` beside this file, or null when there is none. */
function ownVersion(ownRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(ownRoot, "package.json"), "utf8"));
    return pkg.name === "om-memory-system" && typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Choose a copy and run it. Resolves to the exit code. */
export async function runLauncher(argv, options = {}) {
  const dir = options.dir ?? join(homedir(), ".omms");
  const execPath = options.execPath ?? process.execPath;
  const ownRoot = options.ownRoot ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const run = options.spawn ?? spawnInherit;
  const { atLeastOwnVersion, args } = parseLauncherArgs(argv);
  const loginItem = args[0] === "web" && args.includes("--login-item");
  const startsFile = join(dir, "web-starts.json");
  const now = options.now ?? Date.now;
  if (loginItem) {
    const failures = recentFailures(startsFile, now()).length;
    if (failures >= RESTART_LIMIT) {
      (options.log ?? appendLog(dir))({ code: "restart-limit", failures });
      // Nothing restarts this exit, so the next login starts with a clean count.
      rmSync(startsFile, { force: true });
      return 0;
    }
  }
  const problems = [];
  const choice = chooseCopy(
    findCandidates({ dir, execPath, ownRoot }, problems),
    atLeastOwnVersion ? ownVersion(ownRoot) : null
  );
  if (choice.kind === "copy") {
    const code = await run(execPath, [join(choice.copy.root, "dist", "cli", "index.js"), ...args]);
    if (loginItem && code !== 0) recordFailure(startsFile, now());
    return code;
  }
  if (choice.kind === "npx") {
    // npm installs npx as a .cmd wrapper on Windows, which only a shell can run.
    const windows = process.platform === "win32";
    // Run from the temp folder. npx prefers a project in the current folder, so a project
    // named om-memory-system (such as this repository) would win over the npm package.
    // The hook input carries the real folder, so nothing else needs the current folder.
    return run(
      windows ? "npx.cmd" : "npx",
      ["--yes", `om-memory-system@${choice.version}`, ...args],
      {
        shell: windows,
        cwd: tmpdir(),
      }
    );
  }
  // `npx -p` installs a fresh copy into npm's cache. A plain `npx om-memory-system@latest`
  // would run a broken global copy of the same version, and `web update` repairs it.
  process.stderr.write(
    problems.length > 0
      ? `omms-launch: no complete OMMS copy found (missing ${problems[0]}). Run: npx -p om-memory-system@latest om-memory-system web update\n`
      : "omms-launch: no OMMS copy found. Install om-memory-system.\n"
  );
  if (loginItem) {
    // The login item sends stderr to /dev/null, so the log is the only trace of the cause.
    (options.log ?? appendLog(dir))({ code: "no-valid-copy", missing: problems[0] ?? null });
    recordFailure(startsFile, now());
  }
  return 1;
}

/** Add a failed login-item start. A failed write only loses the limit, never the start. */
function recordFailure(file, at) {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify([...recentFailures(file, at), at]), { mode: 0o600 });
  } catch {
    /* Without the file the supervisor still waits 30 seconds between starts. */
  }
}

/** True when this file is the program Node.js started. A path that cannot be resolved is not. */
function runDirectly() {
  try {
    const entry = process.argv[1];
    return Boolean(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // A loader or wrapper can leave argv[1] pointing at a file that is not there.
    return false;
  }
}

if (runDirectly()) {
  runLauncher(process.argv.slice(2)).then((code) => process.exit(code));
}
