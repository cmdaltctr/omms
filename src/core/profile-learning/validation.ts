import { log } from "../../services/logger.js";
import { sortProfileItems } from "../../utils/profile.js";
import type { UserProfileData } from "../../services/user-profile/types.js";

// The check of older profile items (`userProfileValidationEnabled`). Moved from the OpenCode
// loop so every host asks the same question and applies the verdicts the same way.

/** The profile store operations that applying a verdict needs. */
export interface ValidationStore {
  syncConfidence(item: any): void;
  evolveAndUpdate(item: any, itemType: string, profileId?: string): Promise<void>;
}

export interface ValidationTask {
  /** The task text added to the model input. */
  task: string;
  /** One key per listed item, in task order, to find the item a verdict names. */
  keys: string[];
}

/** The check needs this many preferences; with fewer, the pass skips it. */
export const MIN_VALIDATION_PREFERENCES = 5;

/**
 * The validation task for the top 5 preferences and top 3 patterns. Returns null, and logs
 * the reason, when the profile has fewer than 5 preferences.
 */
export function buildValidationTask(decayed: UserProfileData): ValidationTask | null {
  const topPrefs = (sortProfileItems(decayed.preferences as any[], "confidence") as any[]).slice(
    0,
    5
  );
  const topPats = (sortProfileItems(decayed.patterns as any[], "frequency") as any[]).slice(0, 3);
  if (topPrefs.length < MIN_VALIDATION_PREFERENCES) {
    log(
      "user-profile-learning: validation skipped",
      { prefCount: topPrefs.length, reason: "needs ≥ 5 preferences" },
      "warn"
    );
    return null;
  }
  const allValidated = [...topPrefs, ...topPats];
  const keys = allValidated.map(
    (p: any) => `${p.category || "_"}||${(p.description || "").substring(0, 30)}`
  );
  const task = `## Task 3: Validate Existing Profile Entries

CRITICAL: Complete Tasks 1-2 (new observations) FIRST. This task is separate — only check whether the entries below still match recent behavior. Do NOT let these descriptions influence your new observations.

${allValidated.map((p: any, i: number) => `${i}. [${p.category || "_"}] ${(p.description || "").substring(0, 30)} (conf: ${Math.round((p.confidence || 0) * 100) / 100})`).join("\n")}

For each entry above, judge whether recent prompts confirm or contradict it. Output:
{"validations": [{"index": 0, "verdict": "confirmed|contradicted|no_evidence|inaccurate|oversimplified", "reason": "one sentence"}]}

Rules:
- confirmed: recent prompts show clear evidence
- contradicted: recent prompts show the user has changed
- inaccurate: the description is directionally wrong (opposite behavior seen)
- oversimplified: the description is too vague, missing important nuance
- no_evidence: recent prompts don't address this topic
- Only mark contradicted if there is explicit evidence the user's behavior has changed`;
  return { task, keys };
}

/**
 * Applies the verdicts of a reply to the matching items of `profileData`, in place. Returns
 * the history text ("validated: N confirmed, ...") or null when no verdict changed an item.
 */
export async function applyValidations(
  store: ValidationStore,
  profileData: UserProfileData,
  llmResult: UserProfileData,
  profileId: string,
  prefKeys?: string[]
): Promise<string | null> {
  const validations = (llmResult as any).validations as
    | Array<{
        index: number;
        verdict: string;
        reason: string;
      }>
    | undefined;
  if (!validations?.length || !prefKeys?.length) return null;

  const allItems = [...profileData.preferences, ...profileData.patterns];
  const results: string[] = [];
  let confirmed = 0;
  let contradicted = 0;
  let inaccurate = 0;
  let oversimplified = 0;

  for (const v of validations) {
    const key = prefKeys[v.index];
    if (!key) continue;
    const item = allItems.find(
      (i) => `${i.category || "_"}||${(i.description || "").substring(0, 30)}` === key
    );
    if (!item) {
      log("user-profile-learning: validation match failed", { index: v.index, key }, "warn");
      continue;
    }

    if (v.verdict === "confirmed") {
      item.alpha = (item.alpha || 1) + 0.5;
      store.syncConfidence(item);
      confirmed++;
      results.push(`confirmed [${v.index}] ${v.reason}`);
    } else if (v.verdict === "contradicted") {
      const oldAlpha = item.alpha || 1;
      item.alpha = oldAlpha * 0.75;
      item.beta = (item.beta || 1) + oldAlpha * 0.25;
      store.syncConfidence(item);
      contradicted++;
      results.push(`contradicted [${v.index}] ${v.reason}`);
    } else if (v.verdict === "inaccurate") {
      const oldAlpha = item.alpha || 1;
      item.alpha = oldAlpha * 0.6;
      item.beta = (item.beta || 1) + oldAlpha * 0.4;
      store.syncConfidence(item);
      inaccurate++;
      results.push(`inaccurate [${v.index}] ${v.reason}`);
    } else if (v.verdict === "oversimplified") {
      const oldAlpha = item.alpha || 1;
      item.alpha = oldAlpha * 0.85;
      item.beta = (item.beta || 1) + oldAlpha * 0.15;
      store.syncConfidence(item);
      oversimplified++;
      results.push(`oversimplified [${v.index}] ${v.reason}`);
      const evidence = (item as any).evidence;
      if (Array.isArray(evidence) && evidence.length >= 3) {
        const itemType = profileData.preferences.includes(item) ? "preference" : "pattern";
        // Await so the in-place description/centroid mutation completes before the
        // caller serializes updatedProfileData — otherwise the evolved description is
        // included or lost nondeterministically. Failures stay non-fatal.
        try {
          await store.evolveAndUpdate(item, itemType, profileId);
        } catch {
          // description evolution is best-effort
        }
      }
    } else {
      results.push(`no_evidence [${v.index}] ${v.reason}`);
    }
  }

  if (results.length > 0) {
    log("user-profile-learning: validation results", { validated: results });
  }
  if (confirmed === 0 && contradicted === 0 && inaccurate === 0 && oversimplified === 0)
    return null;

  return `validated: ${confirmed} confirmed, ${contradicted} contradicted, ${inaccurate} inaccurate, ${oversimplified} oversimplified`;
}
