import { statSync } from "node:fs";
import type { ImportPathMap } from "./importer.js";
import type { OpencodeSourceSession } from "./opencode-reader.js";

function isDirectory(path: string | null | undefined): path is string {
  if (!path) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Prefer the recorded directory, then an explicit map, then the project root. */
export function resolveOpencodeProject(
  recordedDirectory: string,
  projectWorktree: string | null,
  maps: ImportPathMap[] = []
): string | null {
  if (isDirectory(recordedDirectory)) return recordedDirectory;
  const mapped = maps.find((item) => item.from === recordedDirectory)?.to;
  if (isDirectory(mapped)) return mapped;
  return projectWorktree !== "/" && isDirectory(projectWorktree) ? projectWorktree : null;
}

export interface UnresolvedProject {
  directory: string;
  sessions: number;
  units: number;
}

/** Resolve each session without buffering its conversation windows. */
export async function* resolveOpencodeSessions(
  sessions: AsyncIterable<OpencodeSourceSession>,
  maps: ImportPathMap[],
  unresolved: Map<string, UnresolvedProject>
): AsyncGenerator<OpencodeSourceSession> {
  for await (const session of sessions) {
    const directory = resolveOpencodeProject(
      session.recordedDirectory,
      session.projectWorktree,
      maps
    );
    if (directory) {
      yield { ...session, directory };
      continue;
    }
    const entry = unresolved.get(session.recordedDirectory) ?? {
      directory: session.recordedDirectory,
      sessions: 0,
      units: 0,
    };
    entry.sessions++;
    entry.units += session.units.length;
    unresolved.set(entry.directory, entry);
  }
}
