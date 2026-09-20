import { readdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Discovery of Pi session files for the historical importer. Read-only: only
 * the first line (the session header) is parsed here, so discovery stays cheap
 * and full parsing happens later per candidate session.
 *
 * Files that are not Pi session format (for example subagent artifacts, which
 * use a different record format without a `type: "session"` header) are
 * reported as unrecognized and skipped rather than treated as errors.
 */

export const DEFAULT_PI_SESSION_ROOT = join(homedir(), ".pi", "agent", "sessions");

export interface DiscoveredPiSession {
  file: string;
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

function readHeaderLine(file: string): { header: any } | { error: string } {
  let firstLine: string;
  try {
    const stream = readFileSync(file, "utf8");
    const newline = stream.indexOf("\n");
    firstLine = (newline === -1 ? stream : stream.slice(0, newline)).trim();
    if (!firstLine) return { error: "empty file" };
    return { header: JSON.parse(firstLine) };
  } catch (error) {
    if (error instanceof SyntaxError) return { error: `malformed header: ${String(error)}` };
    return { error: `unreadable: ${String(error)}` };
  }
}

export function discoverPiSessions(options: DiscoveryOptions = {}): DiscoveryResult {
  const root = options.root ?? DEFAULT_PI_SESSION_ROOT;
  const sessions: DiscoveredPiSession[] = [];
  const unrecognized: UnrecognizedFile[] = [];

  if (!existsSync(root)) {
    return { sessions, unrecognized };
  }

  for (const file of listJsonlFiles(root)) {
    const parsed = readHeaderLine(file);
    if ("error" in parsed) {
      unrecognized.push({ file, reason: parsed.error });
      continue;
    }
    const header = parsed.header;
    if (header?.type !== "session") {
      unrecognized.push({ file, reason: "not a Pi session file (no session header)" });
      continue;
    }
    const timestamp = typeof header.timestamp === "string" ? Date.parse(header.timestamp) : NaN;
    sessions.push({
      file,
      sessionId: typeof header.id === "string" ? header.id : null,
      cwd: typeof header.cwd === "string" ? header.cwd : null,
      version: typeof header.version === "number" ? header.version : null,
      timestamp: Number.isNaN(timestamp) ? null : timestamp,
    });
  }

  // Chronological order, oldest first; files without a timestamp sort last.
  sessions.sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity));

  const limited =
    options.maxSessions !== undefined && options.maxSessions >= 0
      ? sessions.slice(0, options.maxSessions)
      : sessions;

  return { sessions: limited, unrecognized };
}
