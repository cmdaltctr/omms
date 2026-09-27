import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { homedir } from "node:os";

/**
 * Discovery of Pi session files for the historical importer. Read-only: only
 * the first line (the session header) is parsed here, from at most the first
 * 64 KB of each file, so discovery stays cheap on large histories and full
 * parsing happens later per candidate session.
 *
 * The root may be a sessions folder or one `.jsonl` session file. Files that
 * are not Pi session format (for example subagent artifacts, which use a
 * different record format without a `type: "session"` header) are reported
 * as unrecognized and skipped rather than treated as errors. Symlinked entries
 * inside a folder are never followed.
 */

export const DEFAULT_PI_SESSION_ROOT = join(homedir(), ".pi", "agent", "sessions");
export const PI_HEADER_READ_LIMIT = 64 * 1024;

export interface DiscoveredPiSession {
  file: string;
  /** Path relative to the root, with `/` separators; the file name for a file root. */
  key: string;
  sessionId: string | null;
  cwd: string | null;
  version: number | null;
  /** Header ISO timestamp converted to epoch ms, when present. */
  timestamp: number | null;
}

export interface UnrecognizedFile {
  file: string;
  reason: string;
}

export interface DiscoveryResult {
  sessions: DiscoveredPiSession[];
  unrecognized: UnrecognizedFile[];
}

/**
 * Bounds on a folder walk. A Pi sessions folder is shallow (one folder per
 * project), so a walk that goes past these is almost certainly a home folder,
 * `/`, or a whole backup volume, and would block the process for minutes.
 */
export interface DiscoveryLimits {
  maxDepth: number;
  maxFolders: number;
  maxFiles: number;
}

export const DEFAULT_DISCOVERY_LIMITS: DiscoveryLimits = {
  maxDepth: 6,
  maxFolders: 5_000,
  maxFiles: 20_000,
};

export class DiscoveryLimitError extends Error {
  constructor() {
    super(
      "This folder is too large to scan for Pi sessions. Choose the Pi sessions folder itself, or one .jsonl file."
    );
    this.name = "DiscoveryLimitError";
  }
}

export interface DiscoveryOptions {
  root?: string;
  maxSessions?: number;
  limits?: DiscoveryLimits;
}

function listJsonlFiles(root: string, limits: DiscoveryLimits): string[] {
  const files: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let folders = 0;
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (++folders > limits.maxFolders) throw new DiscoveryLimitError();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth + 1 > limits.maxDepth) throw new DiscoveryLimitError();
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        if (files.length >= limits.maxFiles) throw new DiscoveryLimitError();
        files.push(full);
      }
    }
  }
  return files.sort();
}

/** Read the first line of a file without reading past `PI_HEADER_READ_LIMIT` bytes. */
export function readFirstLine(file: string, limit = PI_HEADER_READ_LIMIT): string {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const read = readSync(fd, buffer, 0, limit, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const newline = text.indexOf("\n");
    return newline === -1 ? text : text.slice(0, newline);
  } finally {
    closeSync(fd);
  }
}

function readHeaderLine(file: string): { header: any } | { error: string } {
  try {
    const firstLine = readFirstLine(file).trim();
    if (!firstLine) return { error: "empty file" };
    return { header: JSON.parse(firstLine) };
  } catch (error) {
    if (error instanceof SyntaxError) return { error: "malformed header" };
    return { error: `unreadable: ${(error as NodeJS.ErrnoException).code ?? "error"}` };
  }
}

/** Parse one file's header, or say why the file is not a Pi session. */
export function readPiSessionHeader(
  file: string,
  key: string
): DiscoveredPiSession | UnrecognizedFile {
  const parsed = readHeaderLine(file);
  if ("error" in parsed) return { file, reason: parsed.error };
  const header = parsed.header;
  if (header?.type !== "session") {
    return { file, reason: "not a Pi session file (no session header)" };
  }
  const timestamp = typeof header.timestamp === "string" ? Date.parse(header.timestamp) : NaN;
  return {
    file,
    key,
    sessionId: typeof header.id === "string" ? header.id : null,
    cwd: typeof header.cwd === "string" ? header.cwd : null,
    version: typeof header.version === "number" ? header.version : null,
    timestamp: Number.isNaN(timestamp) ? null : timestamp,
  };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function discoverPiSessions(options: DiscoveryOptions = {}): DiscoveryResult {
  const root = options.root ?? DEFAULT_PI_SESSION_ROOT;
  const sessions: DiscoveredPiSession[] = [];
  const unrecognized: UnrecognizedFile[] = [];

  if (!existsSync(root)) {
    return { sessions, unrecognized };
  }

  const files = isFile(root)
    ? [{ file: root, key: basename(root) }]
    : listJsonlFiles(root, options.limits ?? DEFAULT_DISCOVERY_LIMITS).map((file) => ({
        file,
        key: relative(root, file).split(sep).join("/"),
      }));

  for (const { file, key } of files) {
    const result = readPiSessionHeader(file, key);
    if ("reason" in result) unrecognized.push(result);
    else sessions.push(result);
  }

  // Chronological order, oldest first; files without a timestamp sort last.
  sessions.sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity));

  const limited =
    options.maxSessions !== undefined && options.maxSessions >= 0
      ? sessions.slice(0, options.maxSessions)
      : sessions;

  return { sessions: limited, unrecognized };
}
