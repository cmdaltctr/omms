import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { claudeProjectsRoot } from "../services/claude-folder.js";
import type { ImportHost } from "./import-args.js";
import { HOST_IMPORTERS, type ImportSourceKind } from "./host-importers.js";

/**
 * History sources chosen on the Settings page. The browser never uploads a
 * file: it names a server-side path, the server checks it once, and later
 * requests carry a signed token that pins the real path, device, and inode.
 */

export interface ImportSourceIdentity {
  host: ImportHost;
  kind: ImportSourceKind;
  realPath: string;
  dev: number;
  ino: number;
}

export class ImportSourceError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "ImportSourceError";
  }
}

// Tokens only need to outlive the server process that issued them.
const TOKEN_KEY = randomBytes(32);

function sign(payload: string): string {
  return createHmac("sha256", TOKEN_KEY).update(payload).digest("base64url");
}

export function signImportSource(identity: ImportSourceIdentity): string {
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readImportSourceToken(token: unknown, host: ImportHost): ImportSourceIdentity {
  if (typeof token !== "string") throw new ImportSourceError("Choose a history source");
  const [payload = "", signature = ""] = token.split(".");
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new ImportSourceError("The history source is no longer valid. Choose it again.");
  }
  const identity = JSON.parse(Buffer.from(payload, "base64url").toString()) as ImportSourceIdentity;
  if (identity.host !== host) throw new ImportSourceError("The source belongs to another host");
  return identity;
}

/** Stable key for sharing snapshots and computing revisions. */
export function importSourceKey(identity: ImportSourceIdentity): string {
  return `${identity.realPath}:${identity.dev}:${identity.ino}`;
}

/** Refuse a source whose path now names another file, such as a swapped-in symlink. */
export function assertImportSourceUnchanged(identity: ImportSourceIdentity): void {
  let current;
  try {
    current = statSync(identity.realPath);
  } catch {
    throw new ImportSourceError("The history source no longer exists. Choose it again.", 409);
  }
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new ImportSourceError("The history source changed. Choose it again.", 409);
  }
}

function checkedPath(path: unknown): string {
  if (typeof path !== "string" || !path.trim()) throw new ImportSourceError("Enter a path");
  if (!isAbsolute(path)) throw new ImportSourceError("Enter an absolute path");
  if (path.split(/[\\/]/).includes("..")) {
    throw new ImportSourceError("The path must not contain '..' segments");
  }
  try {
    // Symlinks at or above the chosen path are fine: macOS /tmp, a linked ~/.pi.
    return realpathSync.native(path);
  } catch {
    throw new ImportSourceError("Path not found");
  }
}

/** The Claude projects folder; `claudeConfigDir` is `CONFIG.claudeConfigDir`. */
export function defaultClaudeSourcePath(claudeConfigDir?: string): string {
  return claudeProjectsRoot(claudeConfigDir);
}

export function defaultImportSourcePath(host: ImportHost, claudeConfigDir?: string): string {
  return HOST_IMPORTERS[host].defaultSourcePath(claudeConfigDir);
}

export interface ValidatedImportSource {
  kind: ImportSourceKind;
  displayPath: string;
  sourceToken: string;
}

/** Check an absolute path's kind and format; never returns file contents. */
export function validateImportSource(host: ImportHost, path: unknown): ValidatedImportSource {
  const realPath = checkedPath(path);
  const info = statSync(realPath);
  const checked = HOST_IMPORTERS[host].sourceKind(realPath, info);
  if ("error" in checked) throw new ImportSourceError(checked.error);
  const { kind } = checked;
  const identity: ImportSourceIdentity = { host, kind, realPath, dev: info.dev, ino: info.ino };
  return { kind, displayPath: realPath, sourceToken: signImportSource(identity) };
}

export interface BrowseEntry {
  name: string;
  path: string;
  kind: "folder" | "pi-file" | "opencode-db";
}

const BROWSE_LIMIT = 500;

/**
 * One folder at a time, with no recursion: subfolders and files the host can
 * import. A Claude Code source is always a folder, so it lists folders only. Symlinked entries are hidden. Only offered on loopback binds.
 */
export function browseImportSources(
  host: ImportHost,
  path?: unknown,
  claudeConfigDir?: string
): { path: string; parent: string | null; entries: BrowseEntry[]; truncated: boolean } {
  let start = path;
  if (start === undefined || start === null || start === "") {
    const preferred = HOST_IMPORTERS[host].browseStart(claudeConfigDir);
    start = existsSync(preferred) ? preferred : homedir();
  }
  const folder = checkedPath(start);
  if (!statSync(folder).isDirectory()) throw new ImportSourceError("Choose a folder to browse");
  const entries: BrowseEntry[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(folder, entry.name);
    const fileKind = entry.isFile() ? HOST_IMPORTERS[host].browseFileKind(entry.name) : null;
    if (entry.isDirectory()) entries.push({ name: entry.name, path: full, kind: "folder" });
    else if (fileKind) entries.push({ name: entry.name, path: full, kind: fileKind });
  }
  entries.sort(
    (a, b) =>
      Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name)
  );
  const parent = dirname(folder);
  return {
    path: folder,
    parent: parent === folder ? null : parent,
    entries: entries.slice(0, BROWSE_LIMIT),
    truncated: entries.length > BROWSE_LIMIT,
  };
}
