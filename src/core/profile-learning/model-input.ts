import { buildCategoryList } from "../extraction.js";
import { truncateToMaxBytes } from "../../utils/context-limit.js";
import type { UserProfileData } from "../../services/user-profile/types.js";

// The model input of a live profile learning pass (change unify-profile-learning, design D1).
// Moved from the OpenCode loop so every host sends the same input. Pure: no config, no store.

/** Ends a model input that was cut to `userProfileMaxContextBytes`. */
export const PROFILE_INPUT_TRUNCATION_MARKER =
  "\n[... context truncated to userProfileMaxContextBytes ...]";

export type ProfilePromptDetail = "full" | "prompts-only";

/** One waiting prompt, as the model input needs it. */
export interface InputPrompt {
  content: string;
}

/** The stored profile, as the model input needs it. */
export interface InputProfile {
  profileData: string;
}

/** The current categories, workflows and item counts of the stored profile. */
export function buildCategorySummary(profileData: UserProfileData): string {
  const catSection = buildCategoryList(profileData);

  const prefCount = profileData.preferences.length;
  const patCount = profileData.patterns.length;
  const wfCount = profileData.workflows.length;

  const wfParts: string[] = [];
  if (wfCount > 0) {
    wfParts.push(
      "## Existing Workflows\nFor reference — only report a workflow when recent prompts show a genuinely NEW sequence, NOT a minor variant of an existing one:"
    );
    profileData.workflows.forEach((wf, i) => {
      const steps = wf.steps?.length
        ? ` (freq ${wf.frequency || 1}x: ${wf.steps.join(" → ")})`
        : "";
      wfParts.push(`${i + 1}. ${wf.description}${steps}`);
    });
  }

  const countSection = `## Profile Size\nPreferences: ${prefCount} | Patterns: ${patCount} | Workflows: ${wfCount}\n
New observations are matched via embedding cosine similarity — write descriptions in your own words; do not reuse existing wording.`;

  return [catSection, ...wfParts, countSection].filter(Boolean).join("\n");
}

/** The full input: prompts, a summary of the stored profile, guidelines and examples. Not cut. */
export function buildFullProfileInput(
  prompts: readonly InputPrompt[],
  existingProfile: InputProfile | null
): string {
  return `# User Profile Analysis

Analyze ${prompts.length} user prompts to ${existingProfile ? "update" : "create"} the user profile.
${existingProfile ? `The merge system will automatically connect your observations to existing profile entries — you only need to describe what you see in these recent prompts.` : `Create a new user profile from scratch based on the prompts below.`}

${existingProfile ? buildCategorySummary(JSON.parse(existingProfile.profileData)) : ""}
## Recent Prompts

${prompts.map((p, i) => `${i + 1}. ${p.content}`).join("\n\n")}

## Analysis Guidelines

Identify and ${existingProfile ? "report" : "create"}:

 1. **Preferences**
   - Code style, communication style, tool preferences
   - Assign confidence 0.3-0.5 based on evidence strength in these recent prompts
   - Include 1-3 example prompts as evidence
   - **Revealed preferences**: when the user chooses one approach over alternatives (e.g. picks simpler solution, skips certain steps), capture the choice as a lower-confidence preference (0.3-0.5). What the user does NOT do is also a signal.

 2. **Patterns**
   - Recurring topics, problem domains, technical interests seen in these prompts
   - Track frequency of occurrence

 3. **Workflows**
    - Distinct, named step sequences the user follows repeatedly
    - Each workflow should represent a DIFFERENT activity (different purpose, different steps)
    - Break down into 3-6 concrete, observable steps, NOT abstract phases
    - Do NOT repeat the same workflow every cycle — only output when you observe a NEW recurring sequence
    - Examples of distinct workflows: "debugging workflow", "code review workflow", "learning workflow", "refactoring workflow"

CRITICAL: Only output observations grounded in the RECENT PROMPTS above. Write descriptions in your own words — the system matches by embedding similarity, not exact wording. Do NOT output entries that lack evidence in recent prompts. Put the core semantics at the beginning of each description, keeping descriptions concise and specific (under 120 characters). Do NOT extract one-time debugging tasks, environment setup issues, or specific error investigations as preferences — these are transient events, not behavioral patterns.

## Few-Shot Examples

❌ Do NOT extract as preference:
- "User is debugging a NullPointerException in auth service" (one-time debugging task)
- "User installed Redis for the first time" (one-time setup event)
- "User ran npm audit fix" (routine maintenance, not a behavioral pattern)

✅ DO extract as preference:
- "User prefers functional programming style over OOP"
- "User consistently writes tests before implementation"
- "User asks for explanations before accepting code changes"

✅ DO extract as workflow (distinct, non-overlapping):
- Debugging workflow: "reproduce the error → check logs → grep source code → trace call chain → propose fix → verify fix"
- Code review workflow: "read the diff → check edge cases → verify consistency with existing patterns → report issues → suggest alternatives"
- Learning workflow: "ask for explanation → request examples → test understanding with a small task → apply to real problem"

❌ Do NOT extract as workflow:
- "User analyzes problems and verifies solutions" (too abstract — not a concrete step sequence)
- "User writes code and tests it" (too generic — covers everything)`;
}

/** The prompts-only input: one numbered line per prompt. Not cut. */
export function buildPromptsOnlyInput(prompts: readonly InputPrompt[]): string {
  return prompts.map((p, i) => `${i + 1}. ${p.content}`).join("\n");
}

/** Cuts the input to `maxBytes` UTF-8 bytes, keeping the head and the tail around the marker. */
export function cutProfileInput(text: string, maxBytes: number): string {
  // UTF-8 byte limit: the marker counts inside the ceiling and a cut never
  // splits a multi-byte character (a character count let multibyte input
  // through oversized and could split surrogate pairs at the cut).
  return truncateToMaxBytes(text, maxBytes, PROFILE_INPUT_TRUNCATION_MARKER);
}

export interface ProfileLearningInputOptions {
  detail: ProfilePromptDetail;
  prompts: readonly InputPrompt[];
  existingProfile: InputProfile | null;
  /** The check of older items, added after the input when the setting is on. */
  validationTask?: string;
  maxBytes: number;
}

/** The model input of one pass, in the chosen detail, cut to the byte limit. */
export function buildProfileLearningInput(options: ProfileLearningInputOptions): string {
  const base =
    options.detail === "prompts-only"
      ? buildPromptsOnlyInput(options.prompts)
      : buildFullProfileInput(options.prompts, options.existingProfile);
  const text = options.validationTask ? base + "\n\n" + options.validationTask : base;
  return cutProfileInput(text, options.maxBytes);
}
