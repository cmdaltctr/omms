import { cosineSimilarityNumbers } from "../../utils/math.js";
import { log } from "../logger.js";
import { ensureArray, lazyMigrateAlpha, syncConfidence } from "./profile-confidence.js";
import type { ProfileHost } from "./profile-host.js";

export async function detectConflicts(
  host: ProfileHost,
  items: any[],
  itemType: string,
  _profileId: string
): Promise<void> {
  const config = host.config;
  const candidates: { a: any; b: any; cos: number }[] = [];
  const limit = items.length;
  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      if (items[i].category !== items[j].category) continue;
      const c1 = items[i].centroid as number[] | undefined;
      const c2 = items[j].centroid as number[] | undefined;
      if (!c1 || !c2) continue;
      const cos = cosineSimilarityNumbers(c1, c2);
      if (cos >= 0.65 && cos < 0.9) {
        candidates.push({ a: items[i], b: items[j], cos });
      }
    }
  }
  if (candidates.length === 0) return;
  const maxChecks = 3;
  candidates.sort((x, y) => y.cos - x.cos);
  let checked = 0;
  const removeIndices: number[] = [];
  for (const { a, b, cos } of candidates) {
    if (checked >= maxChecks) break;
    if (removeIndices.includes(items.indexOf(a)) || removeIndices.includes(items.indexOf(b)))
      continue;
    checked++;
    const conflict = await host.checkConflict(a.description, b.description);
    if (conflict) {
      const keeper = (a.frequency || 0) >= (b.frequency || 0) ? a : b;
      const removed = keeper === a ? b : a;
      lazyMigrateAlpha(keeper, config);
      lazyMigrateAlpha(removed, config);
      const oldAlpha = keeper.alpha || 1;
      keeper.alpha *= 0.75;
      keeper.beta = (keeper.beta || 1) + 0.25 * oldAlpha;
      keeper.alpha += removed.alpha || 0;
      keeper.frequency = (keeper.frequency || 0) + (removed.frequency || 0);
      keeper.evidence = [
        ...new Set([...ensureArray(keeper.evidence), ...ensureArray(removed.evidence)]),
      ].slice(0, 10);
      if (itemType === "workflow") {
        keeper.steps =
          keeper.steps?.length >= (removed.steps?.length || 0) ? keeper.steps : removed.steps;
      }
      const removedIdx = items.indexOf(removed);
      if (removedIdx >= 0) removeIndices.push(removedIdx);
      syncConfidence(keeper, config);
      log("profile conflict detected: resolved", {
        type: itemType,
        keeper: (keeper.description || "").substring(0, 40),
        removed: (removed.description || "").substring(0, 40),
        cos: Math.round(cos * 100) / 100,
        alphaDrop: `${Math.round(oldAlpha)}→${Math.round(keeper.alpha)}`,
      });
    }
  }
  for (let i = removeIndices.length - 1; i >= 0; i--) {
    items.splice(removeIndices[i]!, 1);
  }
}

export async function deduplicateItems(
  host: ProfileHost,
  items: any[],
  itemType: string,
  profileId?: string
): Promise<void> {
  if (!profileId || items.length < 2) return;
  const config = host.config;

  const checkedPairs = host.dedupCheckedCache;
  const maxLLMCalls = 5;
  let llmCalls = 0;
  let skippedCached = 0;

  const byCategory = new Map<string, typeof items>();
  for (const item of items) {
    const cat = item.category || "_uncategorized";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }

  for (const [, group] of byCategory) {
    if (group.length < 2) continue;

    const candidates: { a: any; b: any; cos: number }[] = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const c1 = group[i].centroid as number[] | undefined;
        const c2 = group[j].centroid as number[] | undefined;
        if (!c1 || !c2) continue;
        const cos = cosineSimilarityNumbers(c1, c2);
        if (cos >= 0.5) {
          candidates.push({ a: group[i], b: group[j], cos });
        }
      }
    }

    if (candidates.length === 0) continue;
    candidates.sort((x, y) => y.cos - x.cos);

    const removeIndices: number[] = [];
    let candidateIdx = 0;
    for (const { a, b, cos } of candidates) {
      candidateIdx++;
      if (llmCalls >= maxLLMCalls) {
        log("profile dedup: LLM call limit reached", {
          itemType,
          skipped: candidates.length - candidateIdx + 1,
        });
        break;
      }
      if (removeIndices.includes(items.indexOf(a)) || removeIndices.includes(items.indexOf(b)))
        continue;

      const pairKey = [a.description, b.description].sort().join("||").substring(0, 100);
      if (checkedPairs.has(pairKey)) {
        skippedCached++;
        continue;
      }

      llmCalls++;
      const isDuplicate = await host.checkSemanticDuplicate(a.description, b.description);

      if (isDuplicate) {
        const keeper = (a.frequency || 0) >= (b.frequency || 0) ? a : b;
        const removed = keeper === a ? b : a;
        keeper.frequency = (keeper.frequency || 0) + (removed.frequency || 0);
        lazyMigrateAlpha(keeper, config);
        lazyMigrateAlpha(removed, config);
        keeper.alpha += removed.alpha || 0;
        keeper.beta = (keeper.beta || 1) + (removed.beta || 1);
        keeper.weakAlpha = (keeper.weakAlpha || 1) + ((removed.weakAlpha || 1) - 1);
        keeper.weakBeta = (keeper.weakBeta || 1) + ((removed.weakBeta || 1) - 1);
        keeper.lastSeen = Math.max(keeper.lastSeen || 0, removed.lastSeen || 0);
        keeper.lastMatchTime = Math.max(keeper.lastMatchTime || 0, removed.lastMatchTime || 0);
        syncConfidence(keeper, config);
        keeper.evidence = [
          ...new Set([...ensureArray(keeper.evidence), ...ensureArray(removed.evidence)]),
        ].slice(0, 10);
        keeper.pendingValidation = !!keeper.pendingValidation && !!removed.pendingValidation;
        if (itemType === "workflow") {
          keeper.steps =
            keeper.steps?.length >= (removed.steps?.length || 0) ? keeper.steps : removed.steps;
        }
        const removedIdx = items.indexOf(removed);
        if (removedIdx >= 0) removeIndices.push(removedIdx);
        checkedPairs.delete(pairKey);
        log("profile dedup: merged duplicate", {
          type: itemType,
          keeper: (keeper.description || "").substring(0, 40),
          removed: (removed.description || "").substring(0, 40),
          cos: Math.round(cos * 100) / 100,
          mergedFreq: keeper.frequency,
        });
      } else {
        checkedPairs.add(pairKey);
        log("profile dedup: no duplicate confirmed", {
          type: itemType,
          cos: Math.round(cos * 100) / 100,
        });
      }
    }

    for (let i = removeIndices.length - 1; i >= 0; i--) {
      items.splice(removeIndices[i]!, 1);
    }
  }

  log("profile dedup complete", {
    type: itemType,
    llmCalls,
    skippedCached,
    itemsAfter: items.length,
  });

  if (checkedPairs.size > 1000) {
    // Drop the oldest 500 pairs. Trimmed in place, because the manager owns this set.
    const entries = [...checkedPairs];
    checkedPairs.clear();
    for (const entry of entries.slice(500)) checkedPairs.add(entry);
  }
}
