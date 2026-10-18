import { open, stat } from "node:fs/promises";
import { getLogFilePath } from "./log-path.js";

export type LogRecordLevel = "info" | "warn" | "error";

export interface LogRecord {
  /** Line number of the record's first line within the tail that was read. */
  seq: number;
  time: string;
  level: LogRecordLevel;
  /** True when the level was guessed from the message, as for lines written before levels. */
  guessed: boolean;
  message: string;
  /** The JSON text after the message, or null when the line has none. */
  data: string | null;
}

export interface SettingsLogQuery {
  lines?: number | string;
  /** `capture` keeps only `Capture attempt` records. */
  filter?: string;
  /** `warn` keeps warn and error records, `error` keeps error records. */
  level?: string;
}

const LEVEL_RANK: Record<LogRecordLevel, number> = { info: 0, warn: 1, error: 2 };
const RECORD_LINE = /^\[([^\]]+)\] (?:(INFO|WARN|ERROR) )?(.*)$/;
const SESSION_LINE = /^--- Session started: (.+) ---$/;

/** Guess the level of a line written before levels, from its message text only. */
export function guessLevel(message: string): LogRecordLevel {
  if (/fail|error|exception/i.test(message)) return "error";
  if (/warn|fallback|falling back|unavailable|skip|retry/i.test(message)) return "warn";
  return "info";
}

function splitData(text: string): { message: string; data: string | null } {
  const at = [text.indexOf(": {"), text.indexOf(": [")].filter((i) => i >= 0);
  if (at.length === 0) return { message: text, data: null };
  const i = Math.min(...at);
  return { message: text.slice(0, i), data: text.slice(i + 2) };
}

function parseRecords(rows: string[]): LogRecord[] {
  const records: LogRecord[] = [];
  rows.forEach((row, seq) => {
    if (row === "") return;
    const session = SESSION_LINE.exec(row);
    if (session) {
      records.push({
        seq,
        time: session[1]!,
        level: "info",
        guessed: false,
        message: "Session started",
        data: null,
      });
      return;
    }
    const match = RECORD_LINE.exec(row);
    if (!match) {
      const last = records.at(-1);
      if (last) last.message += `\n${row}`;
      else records.push({ seq, time: "", level: "info", guessed: true, message: row, data: null });
      return;
    }
    const { message, data } = splitData(match[3]!);
    const token = match[2];
    records.push({
      seq,
      time: match[1]!,
      level: token ? (token.toLowerCase() as LogRecordLevel) : guessLevel(message),
      guessed: !token,
      message,
      data,
    });
  });
  return records;
}

/** Read the bounded tail of OMMS's own log. The request cannot choose a path. */
export async function readSettingsLog(
  query: SettingsLogQuery = {}
): Promise<{ path: string; records: LogRecord[] }> {
  const path = getLogFilePath();
  const lines = Number(query.lines ?? 200);
  const count = Number.isFinite(lines) ? Math.max(1, Math.min(2000, Math.floor(lines))) : 200;
  const minimum = query.level === "warn" || query.level === "error" ? query.level : "info";
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, records: [] };
    throw error;
  }
  const start = Math.max(0, size - 256 * 1024);
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const whole = start === 0 ? text : text.slice(text.indexOf("\n") + 1);
    if (start > 0 && !text.includes("\n")) return { path, records: [] };
    const rows = whole.split(/\r?\n/);
    if (rows.at(-1) === "") rows.pop();
    const records = parseRecords(rows).filter(
      (record) =>
        LEVEL_RANK[record.level] >= LEVEL_RANK[minimum] &&
        (query.filter !== "capture" || record.message.includes("Capture attempt"))
    );
    return { path, records: records.slice(-count) };
  } finally {
    await file.close();
  }
}
