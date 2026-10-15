/**
 * Smart category cleanup: group profile category names by meaning, let the profile
 * model check and name each group, then apply a rename-only change the user accepted.
 * See openspec/changes/smart-category-cleanup.
 */
import { CONFIG } from "../../config.js";
import { log } from "../logger.js";
import { applySafeExtraParams } from "../ai/providers/base-provider.js";
import { completeStructured, resolveHostProfileModel } from "./profile-model.js";
import {
  CATEGORY_GROUP_THRESHOLD,
  collectCategoryLabels,
  groupCategoryLabels,
  groupId,
  recordRenames,
  restoreRenames,
  type CategoryGroup,
  type CategoryLabelCount,
} from "./category-groups.js";
import { canonicaliseCategories, categoryKey, tidyCategory } from "./profile-category.js";
import { latestOpenCleanup, markCleanupUndone, recordCleanup } from "./category-cleanup-store.js";
import type { UserProfileManager } from "./user-profile-manager.js";
import type { UserProfileData } from "./types.js";

export const GROUPS_PER_MODEL_CALL = 20;
export const MAX_EXAMPLES_PER_LABEL = 3;
/**
 * Time limit per model call. A reasoning model took about 110 s per batch on the
 * live profile (TDR-044), so the 60 s profile cleanup limit timed out every batch.
 */
export const CATEGORY_CLEANUP_MODEL_TIMEOUT_MS = 180_000;
const MAX_NAME_LENGTH = 60;

/** Rejects with the message when the work takes longer than the limit, and always clears its timer. */
export async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Sends one prompt and returns the parsed JSON reply; throws on any failure. */
export type CleanupModel = (systemPrompt: string, userPrompt: string) => Promise<unknown>;

export interface NamedGroup extends CategoryGroup {
  name: string;
  /** False when the model did not check this group and the most used label was chosen. */
  checked: boolean;
}

const SYSTEM_PROMPT =
  "You tidy the category names of a user profile. Return only JSON without markdown wrapping.";

function buildPrompt(groups: CategoryGroup[], examples: Map<string, string[]>): string {
  const payload = groups.map((group) => ({
    group: group.id,
    labels: group.labels.map((entry) => ({
      name: entry.label,
      count: entry.count,
      examples: (examples.get(entry.label) ?? []).slice(0, MAX_EXAMPLES_PER_LABEL),
    })),
  }));
  return `Each group below holds category names that may mean the same thing. The examples show memories filed under each name.

For each group:
1. "keep": the names that mean the same thing as each other. Leave out any name with a different meaning.
2. "name": one short category name for the kept names. Prefer an existing name when one fits.

Groups:
${JSON.stringify(payload)}

Return JSON only: { "groups": [ { "group": "<id>", "keep": ["<name>", "..."], "name": "<name>" } ] }`;
}

function fallback(group: CategoryGroup): NamedGroup {
  return { ...group, name: group.labels[0]!.label, checked: false };
}

function readReply(reply: unknown): Map<string, { keep: unknown; name: unknown }> {
  const entries = (reply as { groups?: unknown } | null)?.groups;
  const byId = new Map<string, { keep: unknown; name: unknown }>();
  if (!Array.isArray(entries)) return byId;
  for (const entry of entries) {
    if (entry && typeof entry === "object" && typeof (entry as any).group === "string") {
      byId.set((entry as any).group, { keep: (entry as any).keep, name: (entry as any).name });
    }
  }
  return byId;
}

function applyReply(
  group: CategoryGroup,
  answer: { keep: unknown; name: unknown } | undefined
): NamedGroup | null {
  if (!answer || !Array.isArray(answer.keep)) return fallback(group);
  const keep = new Set(answer.keep.filter((name): name is string => typeof name === "string"));
  const labels: CategoryLabelCount[] = group.labels.filter((entry) => keep.has(entry.label));
  if (labels.length < 2) return null;
  const name =
    typeof answer.name === "string" &&
    answer.name.trim() &&
    answer.name.trim().length <= MAX_NAME_LENGTH
      ? answer.name.trim()
      : labels[0]!.label;
  return { id: groupId(labels), labels, name, checked: true };
}

/**
 * The profile model checks each group in batches: it removes names that do not belong
 * and proposes one name. A failed batch, a missing reply, or no model falls back to the
 * most used label and marks the group unchecked. The log holds counts and codes only.
 */
export async function checkAndNameGroups(
  groups: CategoryGroup[],
  examples: Map<string, string[]>,
  model: CleanupModel | null,
  /** Called with batches done and the total, before the first batch and after each one. */
  onProgress?: (done: number, total: number) => void
): Promise<NamedGroup[]> {
  const batches: CategoryGroup[][] = [];
  for (let start = 0; start < groups.length; start += GROUPS_PER_MODEL_CALL) {
    batches.push(groups.slice(start, start + GROUPS_PER_MODEL_CALL));
  }
  let failedBatches = 0;
  let dropped = 0;
  const checkBatch = async (batch: CategoryGroup[]): Promise<NamedGroup[]> => {
    if (!model) return batch.map(fallback);
    let replies: Map<string, { keep: unknown; name: unknown }>;
    try {
      replies = readReply(await model(SYSTEM_PROMPT, buildPrompt(batch, examples)));
    } catch (error) {
      failedBatches++;
      log("category cleanup: model batch failed", {
        groups: batch.length,
        code: error instanceof Error ? error.name : "unknown",
      });
      return batch.map(fallback);
    }
    const results: NamedGroup[] = [];
    for (const group of batch) {
      const result = applyReply(group, replies.get(group.id));
      if (result) results.push(result);
      else dropped++;
    }
    return results;
  };

  // One call at a time: a provider that refuses parallel calls still finishes (TDR-044).
  const named: NamedGroup[] = [];
  onProgress?.(0, batches.length);
  for (const [index, batch] of batches.entries()) {
    named.push(...(await checkBatch(batch)));
    onProgress?.(index + 1, batches.length);
  }
  log("category cleanup: groups checked", {
    groups: groups.length,
    named: named.length,
    dropped,
    unchecked: named.filter((group) => !group.checked).length,
    failedBatches,
    model: model ? "available" : "none",
  });
  return named;
}

/** The host model when one is registered, else the external API, else none. */
export async function resolveCleanupModel(): Promise<CleanupModel | null> {
  const hostModel = await resolveHostProfileModel();
  if (hostModel) {
    const { z } = await import("zod");
    const schema = z.object({
      groups: z.array(z.object({ group: z.string(), keep: z.array(z.string()), name: z.string() })),
    });
    return (systemPrompt, userPrompt) =>
      withTimeout(
        completeStructured(hostModel, systemPrompt, userPrompt, schema),
        CATEGORY_CLEANUP_MODEL_TIMEOUT_MS,
        "category cleanup timeout"
      );
  }
  if (CONFIG.memoryModel && CONFIG.memoryApiUrl) {
    return async (systemPrompt, userPrompt) => {
      const requestBody: Record<string, unknown> = {};
      if (CONFIG.memoryExtraParams) applySafeExtraParams(requestBody, CONFIG.memoryExtraParams);
      Object.assign(requestBody, {
        model: CONFIG.memoryModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      });
      const response = await fetch(`${CONFIG.memoryApiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.memoryApiKey || ""}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(CATEGORY_CLEANUP_MODEL_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`API request failed: ${response.status}`);
      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content in API response");
      return JSON.parse(content);
    };
  }
  return null;
}

export interface CleanupDeps {
  manager?: UserProfileManager;
  /** Embeds one category name; defaults to the configured embedder. */
  embed?: (text: string) => Promise<number[]>;
  /** Undefined resolves the profile model; null runs without one. */
  model?: CleanupModel | null;
  threshold?: number;
  /** Reports model batches done and the total while a preview is built. */
  onProgress?: (done: number, total: number) => void;
}

export interface CategoryCleanupPreview {
  profileId: string;
  /** Distinct categories now, and if every group were accepted. */
  before: number;
  after: number;
  groups: NamedGroup[];
}

export interface AcceptedGroup {
  labels: string[];
  name: string;
}

export type ApplyResult =
  { ok: true; renamed: number } | { ok: false; error: "stale" | "no_profile" | "invalid" };
export type UndoResult =
  | { ok: true; restored: number; notFound: number }
  | { ok: false; error: "nothing_to_undo" | "stale" };

async function managerOf(deps: CleanupDeps): Promise<UserProfileManager> {
  return deps.manager ?? (await import("./user-profile-manager.js")).userProfileManager;
}

async function defaultEmbed(): Promise<(text: string) => Promise<number[]>> {
  const { EmbeddingService } = await import("../embedding.js");
  const service = EmbeddingService.getInstance();
  return async (text) => Array.from(await service.embed(text, { task: "document" }));
}

function readProfile(profileData: string): UserProfileData {
  const parsed = JSON.parse(profileData) as Partial<UserProfileData>;
  return canonicaliseCategories({
    ...parsed,
    preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
    workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
  } as UserProfileData);
}

function examplesByLabel(data: UserProfileData): Map<string, string[]> {
  const items = [...data.preferences, ...data.patterns].sort(
    (a, b) => (b.frequency ?? 0) - (a.frequency ?? 0)
  );
  const examples = new Map<string, string[]>();
  for (const item of items) {
    const list = examples.get(item.category) ?? [];
    if (list.length < MAX_EXAMPLES_PER_LABEL) list.push(item.description);
    examples.set(item.category, list);
  }
  return examples;
}

function countAfter(
  labels: CategoryLabelCount[],
  groups: { labels: { label: string }[]; name: string }[]
): number {
  const rename = new Map<string, string>();
  for (const group of groups) {
    for (const entry of group.labels) rename.set(entry.label, tidyCategory(group.name));
  }
  return new Set(labels.map((entry) => categoryKey(rename.get(entry.label) ?? entry.label))).size;
}

/** Builds the groups for review. Changes nothing in the stored profile. */
export async function previewCategoryCleanup(
  userId: string,
  deps: CleanupDeps = {}
): Promise<CategoryCleanupPreview | null> {
  const manager = await managerOf(deps);
  const profile = await manager.getActiveProfile(userId);
  if (!profile) return null;
  const data = readProfile(profile.profileData);
  const labels = collectCategoryLabels(data);
  const embed = deps.embed ?? (await defaultEmbed());
  const vectors = [];
  for (const entry of labels) vectors.push({ ...entry, vector: await embed(entry.label) });
  const groups = groupCategoryLabels(vectors, deps.threshold ?? CATEGORY_GROUP_THRESHOLD);
  const model = deps.model === undefined ? await resolveCleanupModel() : deps.model;
  const named = await checkAndNameGroups(groups, examplesByLabel(data), model, deps.onProgress);
  log("category cleanup: preview built", {
    labels: labels.length,
    groups: named.length,
  });
  return {
    profileId: profile.id,
    before: labels.length,
    after: countAfter(labels, named),
    groups: named,
  };
}

function validGroups(groups: unknown): groups is AcceptedGroup[] {
  return (
    Array.isArray(groups) &&
    groups.every(
      (group) =>
        group &&
        Array.isArray(group.labels) &&
        group.labels.length >= 2 &&
        group.labels.every((label: unknown) => typeof label === "string") &&
        typeof group.name === "string" &&
        group.name.trim().length > 0
    )
  );
}

/**
 * Renames the categories of the accepted groups on the profile as stored now. Learning may
 * have saved newer versions since the preview; the rename goes by label, so that is safe.
 * It refuses only when a save lands between the read and the write below.
 */
export async function applyCategoryCleanup(
  userId: string,
  input: { groups: AcceptedGroup[] },
  deps: CleanupDeps = {}
): Promise<ApplyResult> {
  if (!validGroups(input?.groups)) return { ok: false, error: "invalid" };
  const manager = await managerOf(deps);
  const profile = await manager.getActiveProfile(userId);
  if (!profile) return { ok: false, error: "no_profile" };

  const data = readProfile(profile.profileData);
  const rename = new Map<string, string>();
  for (const group of input.groups) {
    for (const label of group.labels) rename.set(label, tidyCategory(group.name));
  }
  const retag = <T extends { category: string }>(items: T[]) =>
    items.map((item) =>
      rename.has(item.category) ? { ...item, category: rename.get(item.category)! } : item
    );
  const next: UserProfileData = {
    ...data,
    preferences: retag(data.preferences),
    patterns: retag(data.patterns),
  };
  const renames = recordRenames(data, canonicaliseCategories(next));
  if (renames.length === 0) return { ok: true, renamed: 0 };

  const summary = `Category cleanup: ${renames.length} items renamed in ${input.groups.length} groups`;
  if (!(await manager.updateProfile(profile.id, next, 0, summary, profile.version))) {
    return { ok: false, error: "stale" };
  }
  await recordCleanup(profile.id, renames);
  log("category cleanup: applied", { groups: input.groups.length, renamed: renames.length });
  return { ok: true, renamed: renames.length };
}

/** Restores the categories of the newest cleanup that is not undone yet. */
export async function undoCategoryCleanup(
  userId: string,
  deps: CleanupDeps = {}
): Promise<UndoResult> {
  const manager = await managerOf(deps);
  const profile = await manager.getActiveProfile(userId);
  if (!profile) return { ok: false, error: "nothing_to_undo" };
  const record = await latestOpenCleanup(profile.id);
  if (!record) return { ok: false, error: "nothing_to_undo" };

  const restored = restoreRenames(readProfile(profile.profileData), record.renames);
  if (restored.restored > 0) {
    const summary = `Category cleanup undone: ${restored.restored} items restored`;
    if (!(await manager.updateProfile(profile.id, restored.profile, 0, summary, profile.version))) {
      return { ok: false, error: "stale" };
    }
  }
  await markCleanupUndone(record.id);
  log("category cleanup: undone", { restored: restored.restored, notFound: restored.notFound });
  return { ok: true, restored: restored.restored, notFound: restored.notFound };
}
