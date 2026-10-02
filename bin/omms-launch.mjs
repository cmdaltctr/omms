#!/usr/bin/env node
// Runs the newest valid OMMS copy on the machine. It needs only Node.js and its
// built-in modules, so the Claude Code plugin (which has no `dist/`) and the
// login item can both run it.
//
//   node omms-launch.mjs [--at-least-own-version] <om-memory-system arguments>
//
// Candidates: the copy named in ~/.omms/runtime.json, the global install beside
// the running Node.js, and the copy that holds this file. With
// `--at-least-own-version`, the version in the `package.json` beside this file is
// the minimum. When no candidate reaches it, the launcher runs
// `npx --yes om-memory-system@<that version>`.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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

/** A valid copy has the package name, a comparable version, and `dist/cli/index.js`. */
function readCopy(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.name !== "om-memory-system" || typeof pkg.version !== "string") return null;
    if (compareVersions(pkg.version, pkg.version) === null) return null;
    return existsSync(join(root, "dist", "cli", "index.js"))
      ? { root, version: pkg.version }
      : null;
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

/** The record's copy, the global installs, and the own copy, in that order. Invalid ones are null. */
export function findCandidates({ dir, execPath, ownRoot }) {
  let recorded = null;
  try {
    const record = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
    if (record && typeof record.root === "string") recorded = readCopy(record.root);
  } catch {
    /* No record, or an unreadable one: the other candidates still work. */
  }
  const globals = globalPackageRoots(execPath).map((root) => readCopy(root));
  return [recorded, ...globals, ownRoot ? readCopy(ownRoot) : null];
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
  const choice = chooseCopy(
    findCandidates({ dir, execPath, ownRoot }),
    atLeastOwnVersion ? ownVersion(ownRoot) : null
  );
  if (choice.kind === "copy")
    return run(execPath, [join(choice.copy.root, "dist", "cli", "index.js"), ...args]);
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
  process.stderr.write("omms-launch: no OMMS copy found. Install om-memory-system.\n");
  return 1;
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  runLauncher(process.argv.slice(2)).then((code) => process.exit(code));
}
