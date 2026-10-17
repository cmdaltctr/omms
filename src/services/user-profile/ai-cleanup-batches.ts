import { log } from "../logger.js";
import type { UserProfileData } from "./types.js";
import {
  addIdsToProfile,
  buildAICleanupPrompt,
  buildItemIndex,
  callAICleanup,
  generateDiff,
  rebuildProfileUsing,
  type AIMapping,
  type CleanupDiff,
  type IndexedProfile,
  type IndexedProfileItem,
} from "./ai-cleanup.js";

/**
 * A large selection sent in one model request runs past the request time limit. The web
 * cleanup therefore sends the selection in batches, one request each, one after another.
 */

const SECTIONS = ["preferences", "patterns", "workflows"] as const;

/** What one batch adds to the review: its changes, and the merged item of each merge. */
export interface BatchCleanupResult {
  diff: CleanupDiff;
  mergedItems: Record<string, unknown>;
}

export interface BatchRunResult extends BatchCleanupResult {
  failedBatches: number;
  failedItems: number;
}

export interface RunInBatchesOptions {
  callBatch?: (batch: IndexedProfile) => Promise<BatchCleanupResult>;
  onProgress?: (done: number, total: number, failed: number) => void;
  isStopped?: () => boolean;
}

/** Indexes the full profile once, so ids are profile positions, and keeps the selected items. */
export function selectForCleanup(
  profileData: UserProfileData,
  includeIds: string[]
): IndexedProfile {
  const idSet = new Set(includeIds);
  const indexed = addIdsToProfile(profileData);
  return {
    preferences: indexed.preferences.filter((p) => idSet.has(p.id)),
    patterns: indexed.patterns.filter((p) => idSet.has(p.id)),
    workflows: indexed.workflows.filter((p) => idSet.has(p.id)),
  };
}

/**
 * Packs each section on its own, sorted by category, so a category of up to `size` items
 * stays in one batch. Likely duplicates share a category, and the model merges only
 * inside a section.
 */
export function splitIntoBatches(indexed: IndexedProfile, size: number): IndexedProfile[] {
  const batches: IndexedProfile[] = [];
  for (const section of SECTIONS) {
    const flush = (items: IndexedProfileItem[]) => {
      if (items.length > 0)
        batches.push({ preferences: [], patterns: [], workflows: [], [section]: items });
    };
    let current: IndexedProfileItem[] = [];
    for (const group of groupByCategory(indexed[section])) {
      if (group.length > size) {
        flush(current);
        current = [];
        for (let i = 0; i < group.length; i += size) {
          const chunk = group.slice(i, i + size);
          if (chunk.length === size) flush(chunk);
          else current = chunk;
        }
      } else if (current.length + group.length > size) {
        flush(current);
        current = [...group];
      } else {
        current.push(...group);
      }
    }
    flush(current);
  }
  return batches;
}

function groupByCategory(items: IndexedProfileItem[]): IndexedProfileItem[][] {
  const groups = new Map<string, IndexedProfileItem[]>();
  for (const item of items) {
    const key = (item.category ?? "").toLowerCase();
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.keys()].sort().map((key) => groups.get(key)!);
}

/** One model request for one batch. */
export async function cleanupBatch(indexed: IndexedProfile): Promise<BatchCleanupResult> {
  const t0 = Date.now();
  const prompt = buildAICleanupPrompt(indexed);
  log("AI cleanup: batch prompt built", { items: countItems(indexed), promptLen: prompt.length });

  const result = await callAICleanup(prompt);
  log("AI cleanup: batch reply received", { callMs: Date.now() - t0 });

  const cleanedById = buildItemIndex(result.profile);
  const originalById = buildItemIndex(indexed);
  return {
    diff: generateDiff(indexed, result.mapping, cleanedById),
    mergedItems: buildMergedItems(result.mapping, cleanedById, originalById),
  };
}

// The merged item of each group, keyed by its target id, so Apply can put a ticked merge
// into a newer profile without the rest of the cleaned batch.
function buildMergedItems(
  mapping: AIMapping,
  cleanedById: Map<string, IndexedProfileItem>,
  originalById: Map<string, IndexedProfileItem>
): Record<string, unknown> {
  const items: Record<string, unknown> = {};
  for (const group of mapping.merged.filter((g) => g.length > 1)) {
    const originals = new Map<string, IndexedProfileItem>();
    for (const id of group) {
      const original = originalById.get(id);
      if (original) originals.set(id, original);
    }
    const one = rebuildProfileUsing(
      { kept: [], merged: [group], removed: [] },
      cleanedById,
      originals
    );
    const item = one.preferences[0] ?? one.patterns[0] ?? one.workflows[0];
    if (item) items[group[0]!] = item;
  }
  return items;
}

/**
 * Runs the batches one after another and joins their results. A failed batch adds
 * nothing, so its items stay as they are. Throws the first error when every batch
 * fails. Returns null when stopped; the stop flag is read before and after each call.
 */
export async function runInBatches(
  batches: IndexedProfile[],
  { callBatch = cleanupBatch, onProgress, isStopped = () => false }: RunInBatchesOptions = {}
): Promise<BatchRunResult | null> {
  const t0 = Date.now();
  const joined: BatchRunResult = {
    diff: { kept: [], merged: [], removed: [] },
    mergedItems: {},
    failedBatches: 0,
    failedItems: 0,
  };
  let firstError: unknown;
  for (const [index, batch] of batches.entries()) {
    if (isStopped()) return null;
    try {
      const result = await callBatch(batch);
      if (isStopped()) return null;
      joined.diff.kept.push(...result.diff.kept);
      joined.diff.merged.push(...result.diff.merged);
      joined.diff.removed.push(...result.diff.removed);
      Object.assign(joined.mergedItems, result.mergedItems);
    } catch (error) {
      if (isStopped()) return null;
      if (joined.failedBatches === 0) firstError = error;
      joined.failedBatches++;
      joined.failedItems += countItems(batch);
      log("AI cleanup: batch failed", {
        batch: index + 1,
        of: batches.length,
        items: countItems(batch),
        reason: failureReason(error),
      });
    }
    onProgress?.(index + 1, batches.length, joined.failedBatches);
  }
  if (batches.length > 0 && joined.failedBatches === batches.length) throw firstError;
  log("AI cleanup: batches finished", {
    batches: batches.length,
    failedBatches: joined.failedBatches,
    totalMs: Date.now() - t0,
  });
  return joined;
}

/** A fixed reason code for the log. Never the error text, which may quote the reply. */
export function failureReason(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
    const status = /API request failed: (\d{3})/.exec(error.message)?.[1];
    if (status) return `http-${status}`;
    if (error instanceof SyntaxError || /valid JSON|No content/.test(error.message)) {
      return "invalid-reply";
    }
  }
  return "error";
}

function countItems(indexed: IndexedProfile): number {
  return indexed.preferences.length + indexed.patterns.length + indexed.workflows.length;
}
