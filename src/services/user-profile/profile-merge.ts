import { hasEnoughWorkflowSteps } from "../../core/extraction.js";
import { EmbeddingService } from "../embedding.js";
import { log } from "../logger.js";
import { rankProfileCandidates } from "./profile-candidate-matching.js";
import { categoryKey } from "./profile-category.js";
import { COLD_BUFFER_DEFAULT_KEY } from "./profile-cold-buffer.js";
import { ensureArray, lazyMigrateAlpha, normalizeDescription } from "./profile-confidence.js";
import { deduplicateItems } from "./profile-dedupe.js";
import { initItem, mergeConfirmedMatch } from "./profile-merge-items.js";
import { matchStrong } from "./profile-merge-strong.js";
import { matchWeak } from "./profile-merge-weak.js";
import type { MergeableItem, MergeRun, ProfileHost } from "./profile-host.js";
import type { UserProfileData } from "./types.js";

export async function mergeProfileData(
  host: ProfileHost,
  existing: UserProfileData,
  updates: Partial<UserProfileData>,
  embedService?: EmbeddingService,
  profileId?: string
): Promise<UserProfileData> {
  const merged: UserProfileData = {
    preferences: ensureArray(existing?.preferences),
    patterns: ensureArray(existing?.patterns),
    workflows: ensureArray(existing?.workflows),
  };

  if (updates.preferences) {
    merged.preferences = await mergeItems(
      host,
      merged.preferences,
      ensureArray(updates.preferences),
      "preference",
      embedService,
      profileId
    );
  }

  if (updates.patterns) {
    merged.patterns = await mergeItems(
      host,
      merged.patterns,
      ensureArray(updates.patterns),
      "pattern",
      embedService,
      profileId
    );
  }

  if (updates.workflows) {
    merged.workflows = await mergeItems(
      host,
      merged.workflows,
      ensureArray(updates.workflows).filter(hasEnoughWorkflowSteps),
      "workflow",
      embedService,
      profileId
    );
  }

  if (profileId) {
    if (merged.preferences.length >= 2) {
      await host.detectConflicts(merged.preferences, "preference", profileId);
      await deduplicateItems(host, merged.preferences, "preference", profileId);
    }
    if (merged.patterns.length >= 2) {
      await host.detectConflicts(merged.patterns, "pattern", profileId);
      await deduplicateItems(host, merged.patterns, "pattern", profileId);
    }
    if (merged.workflows.length >= 2) {
      await host.detectConflicts(merged.workflows, "workflow", profileId);
      await deduplicateItems(host, merged.workflows, "workflow", profileId);
    }
  }

  return merged;
}

async function mergeItems<T extends MergeableItem>(
  host: ProfileHost,
  existing: T[],
  incoming: T[],
  itemType: "preference" | "pattern" | "workflow",
  embedService?: EmbeddingService,
  profileId?: string
): Promise<T[]> {
  const config = host.config;
  const embed = embedService ?? EmbeddingService.getInstance();
  const useEmbedding = embed.isWarmedUp;
  const minDescLen = config.userProfileEmbeddingMinDescriptionLength;
  const sameCatStrong = config.userProfileEmbeddingThresholdSameCat;
  const driftThreshold = config.userProfileCentroidDriftThreshold;
  // Workflows have no category, so the same-category rules below would apply to every
  // pair. They match only in the strong band and never absorb other workflows.
  const isWorkflow = itemType === "workflow";
  const run: MergeRun = { itemType, isWorkflow, profileId, sameCatStrong, driftThreshold };

  if (!useEmbedding) {
    log("profile embedding skipped: model not warmed up", undefined, "warn");
  }

  for (const item of existing) {
    lazyMigrateAlpha(item as any, config);
    if ((item as any).lastSeen === undefined)
      (item as any).lastSeen = (item as any).lastUpdated || Date.now();
    if ((item as any).evidence === undefined) (item as any).evidence = [];

    if (useEmbedding && item.description.length >= minDescLen && !(item as any).centroid) {
      try {
        const emb = await embed.embed(normalizeDescription(item.description), {
          task: "document",
        });
        const arr = Array.from(emb);
        (item as any).centroid = arr;
        (item as any).anchor = arr;
        log("profile centroid migrated", { desc: item.description.substring(0, 30) });
      } catch (e) {
        log(
          "profile centroid migration failed",
          {
            desc: item.description.substring(0, 30),
            error: String(e),
          },
          "error"
        );
      }
    }
  }

  let matchCount = 0;
  let newCount = 0;
  // Scope the cold buffer to this profile so we only drain items observed for the
  // same user (see COLD_BUFFER_DEFAULT_KEY for the unattributed case).
  const coldBuffer = host.getColdBuffer(profileId);
  if (useEmbedding && (coldBuffer as any)[itemType + "s"].length > 0) {
    const buffered = [...(coldBuffer as any)[itemType + "s"]];
    (coldBuffer as any)[itemType + "s"] = [];
    host.saveColdBuffers();
    log("profile cold start: draining buffer", {
      type: itemType,
      profileId: profileId || COLD_BUFFER_DEFAULT_KEY,
      bufferSize: buffered.length,
    });
    incoming = [...buffered, ...incoming];
  }
  log("profile merge start", {
    type: itemType,
    existingCount: existing.length,
    incomingCount: incoming.length,
    embeddingReady: useEmbedding,
  });

  for (const newItem of incoming) {
    const exactIdx = existing.findIndex(
      (e) =>
        (isWorkflow
          ? e.category === newItem.category
          : categoryKey(e.category ?? "") === categoryKey(newItem.category ?? "")) &&
        e.description === newItem.description
    );

    if (exactIdx >= 0) {
      const oldFreq = (existing[exactIdx] as any).frequency || 1;
      existing[exactIdx] = mergeConfirmedMatch(existing[exactIdx], newItem, itemType, true, config);
      matchCount++;
      log("profile matched: exact", {
        type: itemType,
        idx: exactIdx,
        cat: newItem.category,
        frequency: `${oldFreq}→${(existing[exactIdx] as any).frequency || "?"}`,
      });
      continue;
    }

    if (useEmbedding && newItem.description.length >= minDescLen) {
      const newEmb = await embed.embed(normalizeDescription(newItem.description), {
        task: "document",
      });
      const rank = rankProfileCandidates(
        existing,
        newItem.category,
        Array.from(newEmb),
        isWorkflow,
        config
      );
      const outcome =
        (await matchStrong(host, run, existing, newItem, newEmb, rank)) ??
        (await matchWeak(host, run, existing, newItem, newEmb, rank));
      if (outcome) {
        matchCount += outcome.matched;
        newCount += outcome.added;
        continue;
      }
    }

    if (!useEmbedding && newItem.description.length >= minDescLen) {
      const isExplicit =
        (newItem as any).category === "explicit" ||
        (Array.isArray((newItem as any).evidence) &&
          (newItem as any).evidence.includes("manual-write"));
      if (!isExplicit) {
        (coldBuffer as any)[itemType + "s"].push(newItem);
        if ((coldBuffer as any)[itemType + "s"].length > 50) {
          (coldBuffer as any)[itemType + "s"].shift();
        }
        host.saveColdBuffers();
        log("profile cold start: buffered", {
          type: itemType,
          profileId: profileId || COLD_BUFFER_DEFAULT_KEY,
          cat: newItem.category,
          bufferSize: (coldBuffer as any)[itemType + "s"].length,
        });
        continue;
      }
    }

    let initCentroid: number[] | undefined;
    let initAnchor: number[] | undefined;
    if (useEmbedding && newItem.description.length >= minDescLen) {
      try {
        const emb = await embed.embed(normalizeDescription(newItem.description), {
          task: "document",
        });
        initCentroid = Array.from(emb);
        initAnchor = initCentroid;
      } catch {
        // keep the item without an embedding centroid
      }
    }

    existing.push(initItem(newItem, itemType, initCentroid, initAnchor, config) as T);
    newCount++;
    log("profile no match: appended new", {
      type: itemType,
      cat: newItem.category,
      desc: (newItem.description || "").substring(0, 40),
    });
  }

  log("profile merge done", {
    type: itemType,
    matched: matchCount,
    appended: newCount,
    existingAfter: existing.length,
  });

  return existing as T[];
}
