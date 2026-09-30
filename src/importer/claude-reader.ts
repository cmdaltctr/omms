import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { CONFIG } from "../config.js";
import { claudeProjectsRoot } from "../services/claude-folder.js";
import { extractScopeFromContainerTag } from "../services/memory-scope.js";
import { getTags } from "../services/tags.js";
import {
  extractClaudeConversationWindows,
  parseClaudeTranscript,
  parseClaudeTranscriptLine,
  type ClaudeConversationWindow,
} from "./claude-conversation.js";
import type { UnrecognizedFile } from "./discovery.js";
import { resolveImportProject } from "./import-project.js";
import {
  countImportableUnits,
  projectFilterTag,
  selectImportWindows,
  type ImportPathMap,
  type ImportProjectReport,
  type ImportSourceSession,
  type LazyImportSource,
} from "./importer.js";

/**
 * Discovery and loading of Claude Code transcripts for the history import.
 * Read-only: transcripts are never written.
 *
 * Claude Code keeps one folder per project under `~/.claude/projects/` and one
 * `<session-id>.jsonl` file per session in it. Subagent transcripts sit one
 * level lower (`<session-id>/subagents/*.jsonl`) and are not sessions, so the
 * walk reads only the root and its direct sub-folders. The root may also be a
 * single project folder or one `.jsonl` file. Symlinks are never followed.
 *
 * Discovery reads each file only up to its first user entry, which carries
 * the working directory and date; units are parsed later, one session at a
 * time.
 */

export const CLAUDE_HEADER_READ_LIMIT = 1024 * 1024;
const READ_CHUNK = 64 * 1024;

/** The Claude projects folder; `claudeConfigDir` is `CONFIG.claudeConfigDir`. */
export function defaultClaudeProjectsRoot(claudeConfigDir?: string): string {
  return claudeProjectsRoot(claudeConfigDir);
}

export interface DiscoveredClaudeSession {
  file: string;
  /** Path relative to the root, with `/` separators; the file name for a file root. */
  key: string;
  sessionId: string;
  /** Working directory of the first user entry. */
  cwd: string | null;
  /** First user entry ISO timestamp converted to epoch ms, when present. */
  timestamp: number | null;
}

export interface ClaudeDiscoveryResult {
  sessions: DiscoveredClaudeSession[];
  unrecognized: UnrecognizedFile[];
}

export interface ClaudeDiscoveryOptions {
  root?: string;
  maxSessions?: number;
}

export interface LoadedClaudeSession {
  sessionId: string;
  sourceFile: string;
  cwd: string | null;
  windows: ClaudeConversationWindow[];
  unreadableLines: number;
  unknownTypes: number;
}

type Candidate = { file: string; key: string } | UnrecognizedFile;

/** A missing folder is an empty history. Any other read error is reported, not hidden. */
function readEntries(dir: string, unreadable: Candidate[]): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") unreadable.push({ file: dir, reason: `unreadable: ${code ?? "error"}` });
    return [];
  }
}

function jsonlCandidate(dir: string, entry: Dirent, keyPrefix: string): Candidate | null {
  if (!entry.name.endsWith(".jsonl")) return null;
  const file = join(dir, entry.name);
  if (!entry.isFile()) return { file, reason: "not a regular file" };
  return { file, key: keyPrefix + entry.name };
}

/** `.jsonl` files in the root and in its direct sub-folders, sorted by key. */
function listCandidates(root: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const entry of readEntries(root, candidates)) {
    if (entry.isDirectory()) {
      const dir = join(root, entry.name);
      for (const child of readEntries(dir, candidates)) {
        const candidate = jsonlCandidate(dir, child, `${entry.name}/`);
        if (candidate) candidates.push(candidate);
      }
      continue;
    }
    const candidate = jsonlCandidate(root, entry, "");
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort((a, b) => a.file.localeCompare(b.file));
}

/** Read lines from the start of a file until `visit` returns true or the limit is reached. */
function scanLines(file: string, visit: (line: string) => boolean, limit: number): void {
  const fd = openSync(file, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.alloc(READ_CHUNK);
    let pending = "";
    let offset = 0;
    while (offset < limit) {
      const read = readSync(fd, buffer, 0, Math.min(READ_CHUNK, limit - offset), offset);
      if (read === 0) break;
      offset += read;
      const lines = (pending + decoder.write(buffer.subarray(0, read))).split("\n");
      pending = lines.pop() ?? "";
      if (lines.some(visit)) return;
    }
    if (offset < limit) visit(pending + decoder.end());
  } finally {
    closeSync(fd);
  }
}

/** Read one file's first user entry, or say why the file is not a usable session. */
export function readClaudeSessionHead(
  file: string,
  key: string
): DiscoveredClaudeSession | UnrecognizedFile {
  let head: DiscoveredClaudeSession | null = null;
  try {
    scanLines(
      file,
      (line) => {
        const parsed = parseClaudeTranscriptLine(line);
        if (parsed.status !== "entry") return false;
        const entry = parsed.entry;
        if (entry.type !== "user" || entry.isSidechain === true) return false;
        const timestamp = Date.parse(entry.timestamp ?? "");
        head = {
          file,
          key,
          sessionId:
            typeof entry.sessionId === "string" ? entry.sessionId : basename(file, ".jsonl"),
          cwd: typeof entry.cwd === "string" ? entry.cwd : null,
          timestamp: Number.isNaN(timestamp) ? null : timestamp,
        };
        return true;
      },
      CLAUDE_HEADER_READ_LIMIT
    );
  } catch (error) {
    return { file, reason: `unreadable: ${(error as NodeJS.ErrnoException).code ?? "error"}` };
  }
  return head ?? { file, reason: "no user entry" };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function discoverClaudeSessions(
  options: ClaudeDiscoveryOptions = {}
): ClaudeDiscoveryResult {
  const root = options.root ?? defaultClaudeProjectsRoot(CONFIG.claudeConfigDir);
  const sessions: DiscoveredClaudeSession[] = [];
  const unrecognized: UnrecognizedFile[] = [];
  if (!existsSync(root)) return { sessions, unrecognized };

  const candidates = isFile(root) ? [{ file: root, key: basename(root) }] : listCandidates(root);
  for (const candidate of candidates) {
    if ("reason" in candidate) {
      unrecognized.push(candidate);
      continue;
    }
    const result = readClaudeSessionHead(candidate.file, candidate.key);
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

/** Parse one transcript into capture windows. Throws when the file cannot be read. */
export function loadClaudeSession(file: string): LoadedClaudeSession {
  const parsed = parseClaudeTranscript(readFileSync(file, "utf8"));
  const first = parsed.entries.find((entry) => entry.type === "user" && entry.isSidechain !== true);
  const withId = parsed.entries.find((entry) => typeof entry.sessionId === "string");
  return {
    sessionId: withId?.sessionId ?? basename(file, ".jsonl"),
    sourceFile: file,
    cwd: typeof first?.cwd === "string" ? first.cwd : null,
    windows: extractClaudeConversationWindows(parsed.entries),
    unreadableLines: parsed.unreadableLines,
    unknownTypes: parsed.unknownTypes,
  };
}

export interface ClaudeHistoryOptions {
  root?: string;
  /** Inclusive bounds on the prompt timestamp (epoch ms). */
  since?: number;
  until?: number;
  /** Web selection: prompts after this epoch ms are held back for a later run. */
  cutoff?: number;
  /** One session, by session ID or file path. */
  session?: string;
  /** Web selection: only these discovery keys. */
  selectionKeys?: string[];
  maxSessions?: number;
  pathMaps?: ImportPathMap[];
  /** Keep only sessions of this project directory (current-project scope). */
  project?: string;
  signal?: AbortSignal;
}

export interface ClaudeHistoryDeps {
  loadSession?: (file: string) => LoadedClaudeSession;
}

/** A lazy import source plus the discovery figures the import report needs. */
export interface ClaudeHistorySource extends LazyImportSource {
  sessionsDiscovered: number;
  sessionsLoaded: number;
  sessionsFilteredOut: number;
  unrecognized: UnrecognizedFile[];
  unresolvableSessions: Array<{ file: string; cwd: string | null }>;
  loadErrors: Array<{ file: string; error: string }>;
  projects: ImportProjectReport[];
  /** Units kept after the date and cutoff filters. */
  unitsKept: number;
  unitsHeldBack: number;
  unitsUntimed: number;
  unreadableLines: number;
  unknownTypes: number;
}

/** Let the web server and live capture run between sessions of a long read. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Discover Claude Code sessions and return them as a `LazyImportSource`. A
 * counting pass loads each selected session once for the totals and the
 * per-project report; `open()` loads them again one at a time, so a large
 * history never holds every turn at once.
 */
export async function openClaudeHistorySource(
  options: ClaudeHistoryOptions = {},
  deps: ClaudeHistoryDeps = {}
): Promise<ClaudeHistorySource> {
  const loadSession = deps.loadSession ?? loadClaudeSession;
  const discovery = discoverClaudeSessions({
    ...(options.root !== undefined ? { root: options.root } : {}),
    ...(options.maxSessions !== undefined ? { maxSessions: options.maxSessions } : {}),
  });
  const selectedKeys = options.selectionKeys ? new Set(options.selectionKeys) : null;
  const projectTag = options.project ? projectFilterTag(options.project) : null;

  const source: ClaudeHistorySource = {
    total: 0,
    open: () => sessions(),
    sessionsDiscovered: discovery.sessions.length,
    sessionsLoaded: 0,
    sessionsFilteredOut: 0,
    unrecognized: discovery.unrecognized,
    unresolvableSessions: [],
    loadErrors: [],
    projects: [],
    unitsKept: 0,
    unitsHeldBack: 0,
    unitsUntimed: 0,
    unreadableLines: 0,
    unknownTypes: 0,
  };

  const selected: Array<{ file: string; directory: string }> = [];
  for (const discovered of discovery.sessions) {
    if (selectedKeys && !selectedKeys.has(discovered.key)) {
      source.sessionsFilteredOut++;
      continue;
    }
    if (
      options.session &&
      discovered.sessionId !== options.session &&
      discovered.file !== options.session
    ) {
      source.sessionsFilteredOut++;
      continue;
    }
    const { directory } = resolveImportProject(discovered.cwd, options.pathMaps ?? []);
    if (!directory) {
      source.unresolvableSessions.push({ file: discovered.file, cwd: discovered.cwd });
      continue;
    }
    if (projectTag && projectFilterTag(directory) !== projectTag) {
      source.sessionsFilteredOut++;
      continue;
    }
    selected.push({ file: discovered.file, directory });
  }

  const build = (session: LoadedClaudeSession, directory: string) => {
    const windows = selectImportWindows(session.windows, options);
    const built: ImportSourceSession = {
      sessionId: session.sessionId,
      directory,
      sourceFile: session.sourceFile,
      units: windows.kept,
    };
    return { built, windows };
  };

  // Counting pass: totals for progress and the report, one session in memory at a time.
  const projects = new Map<string, ImportProjectReport & { sessionIds: Set<string> }>();
  const counted: typeof selected = [];
  for (const item of selected) {
    if (options.signal?.aborted) break;
    let session: LoadedClaudeSession;
    try {
      session = loadSession(item.file);
    } catch (error) {
      source.loadErrors.push({ file: item.file, error: errorMessage(error) });
      continue;
    }
    const { built, windows } = build(session, item.directory);
    const tag = getTags(item.directory).project.tag;
    const project = projects.get(tag) ?? {
      tag,
      hash: extractScopeFromContainerTag(tag).hash,
      directory: item.directory,
      sessions: 0,
      units: 0,
      sessionIds: new Set<string>(),
    };
    project.sessionIds.add(session.sessionId);
    project.sessions = project.sessionIds.size;
    project.units += windows.kept.length;
    projects.set(tag, project);
    source.total += countImportableUnits(built, "claude-code", options);
    source.unitsKept += windows.kept.length;
    source.unitsHeldBack += windows.heldBack;
    source.unitsUntimed += windows.untimed;
    source.unreadableLines += session.unreadableLines;
    source.unknownTypes += session.unknownTypes;
    source.sessionsLoaded++;
    counted.push(item);
    await yieldToEventLoop();
  }
  source.projects = [...projects.values()].map(({ sessionIds: _ids, ...project }) => project);

  async function* sessions(): AsyncGenerator<ImportSourceSession> {
    for (const item of counted) {
      if (options.signal?.aborted) return;
      await yieldToEventLoop();
      let session: LoadedClaudeSession;
      try {
        session = loadSession(item.file);
      } catch (error) {
        // The file changed or vanished after the counting pass.
        source.loadErrors.push({ file: item.file, error: errorMessage(error) });
        continue;
      }
      yield build(session, item.directory).built;
    }
  }

  return source;
}
