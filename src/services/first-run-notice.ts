import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The first-run notice: one plain message per host that says what OMMS does on
// its own. The record of shown notices lives in the global storage folder, so a
// memory space switch never shows it again. It holds no handle, so it needs no
// `resettable()`. It imports no config: callers pass what it needs.

/** The config values the notice text depends on. */
export interface FirstRunNoticeConfig {
  autoBackfill: boolean;
  webServerAutoStart: boolean;
  embeddingApiUrl?: string;
}

const RECORD_FILE = "first-run-notices.json";

/**
 * The notice lines for one host, or an empty list when every part is off.
 * A part that is already off in the config is left out. `loginItem` is false for a
 * host that never installs the login item (Claude Code).
 */
export function firstRunNoticeLines(
  config: FirstRunNoticeConfig,
  host: { loginItem: boolean }
): string[] {
  const parts: string[] = [];
  if (config.autoBackfill) {
    parts.push(
      'Automatic history import: OMMS reads your past chats and makes model calls to save memories. Turn it off with "autoBackfill": false in the global config, or pause it on the Settings page.'
    );
  }
  if (host.loginItem && config.webServerAutoStart) {
    parts.push(
      'Login item: OMMS starts its web app when you sign in. Turn it off with "webServerAutoStart": false in the global config.'
    );
  }
  if (!config.embeddingApiUrl?.trim()) {
    parts.push(
      "Embedding model: OMMS downloads a local model once (about 550 MB), the first time it saves a memory. Skip the download by setting an embedding API URL in Settings."
    );
  }
  return parts.length > 0 ? ["OMMS does these things on its own:", ...parts] : [];
}

/** The file operations the record needs. A test passes its own. */
export interface NoticeFs {
  /** File text, or null when the file is missing. */
  readFile(path: string): string | null;
  /** Writes the whole file atomically. Throws on failure. */
  writeAtomic(path: string, text: string): void;
  /** Receives a short code, never text from the record. */
  log?(code: string): void;
}

export const nodeNoticeFs: NoticeFs = {
  readFile(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeAtomic(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, text);
      renameSync(temp, path);
    } finally {
      rmSync(temp, { force: true });
    }
  },
  log(code) {
    // Loaded on demand so this module stays light for the Claude Code hook.
    void import("./logger.js")
      .then(({ log }) => log("First-run notice record failed", { code }, "warn"))
      .catch(() => {});
  },
};

/** A missing, broken or non-object record counts as empty. */
function readRecord(path: string, fs: NoticeFs): Record<string, true> {
  const text = fs.readFile(path);
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, true>;
    }
  } catch {
    // A broken record is rewritten on the next claim.
  }
  return {};
}

/** Read-only. True when the key is already claimed in `folder`. */
export function noticeClaimed(key: string, folder: string, fs: NoticeFs = nodeNoticeFs): boolean {
  return readRecord(join(folder, RECORD_FILE), fs)[key] === true;
}

/**
 * True the first time a key is claimed in `folder`, false after that and when the
 * record cannot be written (so a failure never shows a notice twice).
 */
export function claimNotice(key: string, folder: string, fs: NoticeFs = nodeNoticeFs): boolean {
  const path = join(folder, RECORD_FILE);
  const record = readRecord(path, fs);
  if (record[key]) return false;
  try {
    fs.writeAtomic(path, `${JSON.stringify({ ...record, [key]: true }, null, 2)}\n`);
    return true;
  } catch {
    fs.log?.("first-run-notice-write-failed");
    return false;
  }
}

/** Forgets a claim, so the key can be claimed again. A missing record is left alone. */
export function clearNotice(key: string, folder: string, fs: NoticeFs = nodeNoticeFs): void {
  const path = join(folder, RECORD_FILE);
  const record = readRecord(path, fs);
  if (!record[key]) return;
  const { [key]: _removed, ...rest } = record;
  try {
    fs.writeAtomic(path, `${JSON.stringify(rest, null, 2)}\n`);
  } catch {
    fs.log?.("first-run-notice-write-failed");
  }
}
