import { userProfileManager } from "./user-profile-manager.js";
import { CONFIG } from "../../config.js";
import type { UserProfileData } from "./types.js";
import { sortProfileItems } from "../../utils/profile.js";
import { log } from "../logger.js";
import { selectProfileItems } from "./profile-relevance.js";

function dedupByCategory(items: any[], topN: number): any[] {
  if (items.length <= topN) return items;
  const seen = new Set<string>();
  const result: any[] = [];
  for (const item of items) {
    if (seen.has(item.category)) continue;
    seen.add(item.category);
    result.push(item);
    if (result.length >= topN) break;
  }
  return result;
}

function scoreByRecency(items: any[]): any[] {
  const now = Date.now();
  return [...items].sort((a, b) => {
    const ageA = (now - (a.lastSeen || 0)) / (24 * 60 * 60 * 1000);
    const ageB = (now - (b.lastSeen || 0)) / (24 * 60 * 60 * 1000);
    const scoreA = (a.confidence || 0) * 0.7 + Math.exp(-ageA / 90) * 0.3;
    const scoreB = (b.confidence || 0) * 0.7 + Math.exp(-ageB / 90) * 0.3;
    return scoreB - scoreA;
  });
}

function escapeContextText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The profile block for the prompt. With `queryVector`, half of each section
 * (rounded up) follows the prompt; without it the block is the same for every
 * prompt, as before.
 */
export async function getUserProfileContext(
  userId: string,
  queryVector?: ArrayLike<number>
): Promise<string | null> {
  const profile = await userProfileManager.getActiveProfile(userId);

  if (!profile) {
    return null;
  }

  let profileData: UserProfileData;
  try {
    profileData = JSON.parse(profile.profileData);
  } catch (e) {
    // A single corrupt row must not break context injection for everyone.
    log("profile context: failed to parse stored profileData", { error: String(e) });
    return null;
  }
  const parts: string[] = [];

  const injectPrefs = CONFIG.userProfileInjectPreferences ?? 5;
  const injectPats = CONFIG.userProfileInjectPatterns ?? 5;
  const injectWfs = CONFIG.userProfileInjectWorkflows ?? 3;

  const sortedPrefs =
    profileData.preferences.length > 0
      ? (sortProfileItems(profileData.preferences as any[], "confidence") as any[])
      : [];
  const sortedPats =
    profileData.patterns.length > 0
      ? (sortProfileItems(profileData.patterns as any[], "frequency") as any[])
      : [];
  const sortedWfs =
    profileData.workflows.length > 0
      ? (sortProfileItems(profileData.workflows as any[], "frequency") as any[])
      : [];

  // The prompt must be about as close to an item as it is to a memory.
  const minCloseness = CONFIG.similarityThreshold;
  const prefs = selectProfileItems({
    baseline: dedupByCategory(scoreByRecency(sortedPrefs.slice(0, injectPrefs * 2)), injectPrefs),
    candidates: sortedPrefs,
    count: injectPrefs,
    queryVector,
    minCloseness,
    onePerCategory: true,
  });
  const pats = selectProfileItems({
    baseline: dedupByCategory(sortedPats, injectPats),
    candidates: sortedPats,
    count: injectPats,
    queryVector,
    minCloseness,
    onePerCategory: true,
  });
  const wfs = selectProfileItems({
    baseline: sortedWfs.slice(0, injectWfs),
    candidates: sortedWfs,
    count: injectWfs,
    queryVector,
    minCloseness,
    onePerCategory: false,
  });
  const topPrefs = prefs.items;
  const topPats = pats.items;
  const topWfs = wfs.items;

  if (topPrefs.length > 0) {
    parts.push("User Preferences:");
    topPrefs.forEach((pref: any) => {
      parts.push(`- [${escapeContextText(pref.category)}] ${escapeContextText(pref.description)}`);
    });
  }

  if (topPats.length > 0) {
    parts.push("\nUser Patterns:");
    topPats.forEach((pattern: any) => {
      parts.push(
        `- [${escapeContextText(pattern.category)}] ${escapeContextText(pattern.description)}`
      );
    });
  }

  if (topWfs.length > 0) {
    parts.push("\nUser Workflows:");
    topWfs.forEach((workflow: any) => {
      const steps = workflow.steps?.length
        ? ` (${workflow.frequency || 1}x: ${workflow.steps.join(" → ")})`
        : ` (${workflow.frequency || 1}x)`;
      parts.push(`- ${escapeContextText(workflow.description)}${escapeContextText(steps)}`);
    });
  }

  if ((profileData as any).learning_paths?.length > 0) {
    parts.push("\nLearning Paths:");
    (profileData as any).learning_paths.slice(0, 3).forEach((path: any) => {
      parts.push(`- ${escapeContextText(path.topic)}: ${escapeContextText(path.description)}`);
    });
  }

  if (parts.length === 0) {
    return null;
  }

  const text = parts.join("\n");

  if (topPrefs.length + topPats.length + topWfs.length > 0) {
    log("profile inject", {
      // Counts only: the log never holds the prompt.
      relevanceSlots: {
        prefs: prefs.relevanceSlots,
        pats: pats.relevanceSlots,
        wfs: wfs.relevanceSlots,
      },
      counts: { prefs: topPrefs.length, pats: topPats.length, wfs: topWfs.length },
      prefs: topPrefs.map((p: any) => `[${p.category}] ${p.description}`.substring(0, 80)),
      pats: topPats.map((p: any) => `[${p.category}] ${p.description}`.substring(0, 80)),
      wfs: topWfs.map((w: any) => w.description.substring(0, 80)),
    });
  }

  return text;
}
