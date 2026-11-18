import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { log } from "../logger.js";

/** Items seen before the embedding model warmed up, held until it is ready. */
export type ColdBuffer = { preferences: any[]; patterns: any[]; workflows: any[] };
export type ColdBuffers = Map<string, ColdBuffer>;

export const COLD_BUFFER_DEFAULT_KEY = "__unattributed__";

function emptyColdBuffer(): ColdBuffer {
  return { preferences: [], patterns: [], workflows: [] };
}

export function getColdBuffer(buffers: ColdBuffers, profileId?: string): ColdBuffer {
  const key = profileId || COLD_BUFFER_DEFAULT_KEY;
  let buf = buffers.get(key);
  if (!buf) {
    buf = emptyColdBuffer();
    buffers.set(key, buf);
  }
  return buf;
}

export function loadColdBuffers(path: string): ColdBuffers {
  const map: ColdBuffers = new Map();
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw);
      // Legacy flat format ({ preferences, patterns, workflows }) is cross-user
      // contaminated and cannot be attributed to a profile, so it is dropped rather
      // than replayed. New format is keyed by profileId.
      const isLegacyFlat =
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        ("preferences" in data || "patterns" in data || "workflows" in data);
      if (data && typeof data === "object" && !Array.isArray(data) && !isLegacyFlat) {
        let loaded = 0;
        for (const [pid, v] of Object.entries<any>(data)) {
          map.set(pid, {
            preferences: Array.isArray(v?.preferences) ? v.preferences : [],
            patterns: Array.isArray(v?.patterns) ? v.patterns : [],
            workflows: Array.isArray(v?.workflows) ? v.workflows : [],
          });
          loaded++;
        }
        if (loaded > 0) {
          log("profile cold buffer: loaded from disk", { profiles: loaded });
        }
      } else if (isLegacyFlat) {
        log("profile cold buffer: dropping legacy unattributed buffer");
      }
    }
  } catch {
    // Corrupt or missing file — start with an empty buffer set.
  }
  return map;
}

export function saveColdBuffers(path: string, buffers: ColdBuffers): void {
  try {
    const obj: Record<string, ColdBuffer> = {};
    for (const [pid, v] of buffers.entries()) {
      if (v.preferences.length || v.patterns.length || v.workflows.length) {
        obj[pid] = v;
      }
    }
    writeFileSync(path, JSON.stringify(obj), "utf-8");
  } catch {
    // Silently ignore disk-full / permission errors.
  }
}
