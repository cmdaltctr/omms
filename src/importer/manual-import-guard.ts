import type { BackfillHost } from "./backfill-model.js";

const running = new Set<BackfillHost>();

/** Keep an automatic run from starting during a manual session import. */
export function beginManualImport(host: BackfillHost): () => void {
  running.add(host);
  return () => running.delete(host);
}

export function isManualImportRunning(host: BackfillHost): boolean {
  return running.has(host);
}
