import { homedir } from "os";
import { join } from "path";

// Kept apart from logger.ts: many tests replace logger.js with a stub that
// only has `log`, so modules that need the paths import them from here.

export function getLogFilePath(): string {
  return (
    process.env.OMMS_LOG_FILE ||
    // Legacy override, still honoured from the opencode-mem days.
    process.env.OPENCODE_MEM_LOG_FILE ||
    join(homedir(), ".omms", "omms.log")
  );
}

export function getLogDirPath(): string {
  const logFile = getLogFilePath();
  const lastSlash = Math.max(logFile.lastIndexOf("/"), logFile.lastIndexOf("\\"));
  return lastSlash === -1 ? "." : logFile.slice(0, lastSlash);
}
