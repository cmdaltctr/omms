import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PiSessionEntry } from "../adapters/pi/conversation.js";

/**
 * Loads a Pi session file for import through Pi's own exported session model
 * (`SessionManager.open`), which handles parsing and legacy-version migration
 * in memory. Read-only: nothing on this code path appends or rewrites the
 * source file.
 *
 * Only this module (and the import command that calls it) imports the Pi
 * package; the importer orchestration stays host-neutral and receives loaded
 * sessions through the loader function so tests can inject fixtures.
 */

export interface LoadedPiSession {
  sessionId: string;
  sourceFile: string;
  cwd: string | null;
  /** Entries of the session's active/current branch, root to leaf. */
  branch: PiSessionEntry[];
}

export function loadPiSessionForImport(file: string): LoadedPiSession {
  const manager = SessionManager.open(file);
  const header = manager.getHeader();
  const branch = (manager.getBranch() ?? []) as unknown as PiSessionEntry[];

  return {
    sessionId: manager.getSessionId(),
    sourceFile: file,
    cwd: header?.cwd ?? null,
    branch,
  };
}
