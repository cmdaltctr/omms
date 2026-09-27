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

export interface DiscoveryOptions {
  root?: string;
  maxSessions?: number;
}

function listJsonlFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
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
    : listJsonlFiles(root).map((file) => ({
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
