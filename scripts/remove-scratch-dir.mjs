import { rmSync } from "node:fs";

/**
 * Removes a scratch folder of a smoke script. Windows can hold a database file open for a
 * moment, or until the process ends (EPERM, EBUSY). The runner is throwaway, so a leftover
 * folder there is harmless and the script goes on. Any other error, and any error on another
 * platform, is thrown. Returns false when it left the folder.
 */
export function removeScratchDir(path, { rm = rmSync, platform = process.platform } = {}) {
  try {
    rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return true;
  } catch (error) {
    if (platform === "win32" && (error?.code === "EPERM" || error?.code === "EBUSY")) return false;
    throw error;
  }
}
