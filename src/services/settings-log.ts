import { open, stat } from "node:fs/promises";
import { getLogFilePath } from "./log-path.js";

/** Read the bounded tail of OMMS's own log. The request cannot choose a path. */
export async function readSettingsLog(lines = 200, captureOnly = false) {
  const path = getLogFilePath();
  const count = Number.isFinite(lines) ? Math.max(1, Math.min(2000, Math.floor(lines))) : 200;
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, lines: [] };
    throw error;
  }
  const start = Math.max(0, size - 256 * 1024);
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const whole = start === 0 ? text : text.slice(text.indexOf("\n") + 1);
    if (start > 0 && !text.includes("\n")) return { path, lines: [] };
    const rows = whole.split(/\r?\n/);
    if (rows.at(-1) === "") rows.pop();
    return {
      path,
      lines: rows.filter((line) => !captureOnly || line.includes("Capture attempt")).slice(-count),
    };
  } finally {
    await file.close();
  }
}
