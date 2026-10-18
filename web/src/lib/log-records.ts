export type LogLevel = "info" | "warn" | "error";
export type LevelFilter = "all" | "warn" | "error";

/** One parsed line of the OMMS log, as `/api/settings/log` returns it. */
export interface LogRecord {
  seq: number;
  time: string;
  level: LogLevel;
  /** True when the level was guessed from the message, as for lines written before levels. */
  guessed: boolean;
  message: string;
  data: string | null;
}

export interface LogTail {
  path: string;
  records: LogRecord[];
}

export function logQuery(level: LevelFilter, captureOnly: boolean): string {
  return `/api/settings/log?lines=200${level === "all" ? "" : `&level=${level}`}${
    captureOnly ? "&filter=capture" : ""
  }`;
}

/** `2026-10-18T18:36:51.802+01:00` becomes `10-18 18:36:51`. Other text is shown as it is. */
export function shortTime(time: string): string {
  const match = /^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(time);
  return match ? `${match[1]} ${match[2]}` : time;
}

/** One record per line, in the same shape the logger writes. */
export function recordsToText(records: LogRecord[]): string {
  return records
    .map((record) => {
      const message = record.message.replace(/\s*\n\s*/g, " ");
      return `${record.time} ${record.level.toUpperCase()} ${message}${
        record.data ? `: ${record.data}` : ""
      }`;
    })
    .join("\n");
}

/** True while the reader has not scrolled up, so new records should pull the view down. */
export function isFollowing(box: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight < 24;
}
