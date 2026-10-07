import { homedir } from "node:os";
import { join } from "node:path";
import { nodeLockFs, type LockFs } from "./web-ensure.js";

// The retire marker that `web update` writes. A standalone web app that waits for
// the port and started before `before` exits. A waiting web app holds no port, so
// a file is the only way to reach it. The marker stays; the next update overwrites it.

export function retireMarkerPath(home = homedir()): string {
  return join(home, ".omms", "web-retire.json");
}

/** Ask every waiting web app started before `before` (epoch ms) to exit. */
export function writeRetireMarker(
  before: number,
  options: { home?: string; fs?: Pick<LockFs, "replace"> } = {}
): void {
  (options.fs ?? nodeLockFs).replace(
    retireMarkerPath(options.home),
    `${JSON.stringify({ before })}\n`
  );
}

/** The marker's `before` time, or null when the marker is missing or damaged. */
export function readRetireMarker(
  options: { home?: string; fs?: Pick<LockFs, "read"> } = {}
): number | null {
  const text = (options.fs ?? nodeLockFs).read(retireMarkerPath(options.home));
  if (text === null) return null;
  try {
    const { before } = JSON.parse(text) as { before?: unknown };
    return typeof before === "number" && Number.isFinite(before) ? before : null;
  } catch {
    return null;
  }
}
