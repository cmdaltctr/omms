import { isInternalPrompt } from "../adapters/opencode/user-prompt.js";
import { analyzeProfile, type ModelPort } from "../core/profile-analysis.js";
import { isFullyPrivate, stripPrivateContent } from "../services/privacy.js";
import { getTags } from "../services/tags.js";
import { userProfileManager } from "../services/user-profile/user-profile-manager.js";
import { userPromptManager } from "../services/user-prompt/user-prompt-manager.js";
import type { MemoryHost } from "../types/index.js";
import { buildImportKey, type ImportSourceSession } from "./importer.js";
import { existsSync } from "node:fs";
import { ImportLedger, importLedgerDbPath } from "./ledger.js";

export interface ProfileImportReport {
  promptsRecorded: number;
  promptsWouldRecord: number;
  promptsAlreadyHandled: number;
  batchesBuilt: number;
  remaining: number;
  error?: string;
}

type PromptStore = Pick<
  typeof userPromptManager,
  | "savePrompt"
  | "markAsCaptured"
  | "countUnanalyzedForUserLearning"
  | "getPromptsForUserLearning"
  | "markMultipleAsUserLearningCaptured"
>;
type ProfileStore = Pick<
  typeof userProfileManager,
  "getActiveProfile" | "createProfile" | "updateProfile"
>;
type Ledger = Pick<ImportLedger, "get" | "begin" | "complete"> &
  Partial<Pick<ImportLedger, "peek">>;

export interface ProfileImportOptions {
  host: MemoryHost;
  dryRun?: boolean;
  batchSize?: number;
  model?: ModelPort;
  ledger?: Ledger;
  promptStore?: PromptStore;
  profileStore?: ProfileStore;
}

/** Record historical prompts and build or update the user profile in batches. */
export async function importProfileFromHistory(
  source: AsyncIterable<ImportSourceSession> | Iterable<ImportSourceSession>,
  options: ProfileImportOptions
): Promise<ProfileImportReport> {
  if (!options.dryRun && !options.model) throw new Error("Profile import needs a model");
  const batchSize = options.batchSize ?? 50;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("Profile batch size must be a positive integer");
  }
  const report: ProfileImportReport = {
    promptsRecorded: 0,
    promptsWouldRecord: 0,
    promptsAlreadyHandled: 0,
    batchesBuilt: 0,
    remaining: 0,
  };
  const ledger = options.ledger ?? new ImportLedger();
  // A dry run reads the ledger only when it exists, so a preview never creates it.
  const ledgerReadable =
    !options.dryRun || Boolean(options.ledger) || existsSync(importLedgerDbPath());
  const prompts = options.promptStore ?? userPromptManager;
  const profiles = options.profileStore ?? userProfileManager;
  let directory: string | undefined;

  for await (const session of source) {
    for (const unit of session.units) {
      const prompt = stripPrivateContent(unit.userPrompt).trim();
      if (
        !prompt ||
        isFullyPrivate(unit.userPrompt) ||
        isInternalPrompt(session.sessionId, prompt)
      ) {
        continue;
      }
      const key = buildImportKey(session.sessionId, unit, options.host);
      if (!key) continue;
      directory ??= session.directory;
      const profileKey = `${key}#profile`;
      const existing = !ledgerReadable
        ? null
        : options.dryRun && ledger.peek
          ? await ledger.peek(profileKey)
          : await ledger.get(profileKey);
      if (existing?.status === "imported") {
        report.promptsAlreadyHandled++;
        continue;
      }
      if (options.dryRun) {
        report.promptsWouldRecord++;
        continue;
      }
      await ledger.begin({
        key: profileKey,
        sessionId: session.sessionId,
        sourceFile: session.sourceFile,
        projectHash: "profile",
      });
      // savePrompt also deduplicates a retry after a crash before ledger completion.
      const promptId = await prompts.savePrompt(
        session.sessionId,
        unit.userEntryId,
        session.directory,
        prompt
      );
      await prompts.markAsCaptured(promptId);
      await ledger.complete(profileKey, promptId);
      report.promptsRecorded++;
    }
  }
  if (options.dryRun || !directory) return report;

  const user = getTags(directory).user;
  if (!user.userEmail) {
    report.remaining = await prompts.countUnanalyzedForUserLearning();
    report.error = "Profile import needs a user email";
    return report;
  }
  const model = options.model!;
  while ((report.remaining = await prompts.countUnanalyzedForUserLearning()) > 0) {
    const batch = await prompts.getPromptsForUserLearning(batchSize);
    if (batch.length === 0) break;
    let succeeded = false;
    for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
      try {
        const existing = await profiles.getActiveProfile(user.userEmail);
        const context = batch.map((item, index) => `${index + 1}. ${item.content}`).join("\n");
        const analysis = await analyzeProfile(
          model,
          context,
          existing ? { id: existing.id, profileData: existing.profileData } : null
        );
        if (existing) {
          if (
            !analysis.merged ||
            !(await profiles.updateProfile(
              existing.id,
              analysis.merged,
              batch.length,
              `History import of ${batch.length} prompts`
            ))
          )
            throw new Error("Profile update conflict");
        } else {
          await profiles.createProfile(
            user.userEmail,
            user.displayName || user.userEmail,
            user.userName || user.userEmail,
            user.userEmail,
            analysis.raw,
            batch.length
          );
        }
        await prompts.markMultipleAsUserLearningCaptured(batch.map((item) => item.id));
        report.batchesBuilt++;
        succeeded = true;
      } catch (error) {
        if (attempt === 1) {
          report.error = error instanceof Error ? error.message : String(error);
          report.remaining = await prompts.countUnanalyzedForUserLearning();
          return report;
        }
      }
    }
  }
  return report;
}
