import { isStructuredSummaryPromptMessage } from "../core/internal-prompt.js";
import type { ModelPort } from "../core/profile-analysis.js";
import { isFullyPrivate, stripPrivateContent } from "../services/privacy.js";
import { getTags } from "../services/tags.js";
import { userProfileManager } from "../services/user-profile/user-profile-manager.js";
import { userPromptManager } from "../services/user-prompt/user-prompt-manager.js";
import type { MemoryHost } from "../types/index.js";
import { buildImportKey, type ImportSourceSession } from "./importer.js";
import { existsSync } from "node:fs";
import { ImportLedger, importLedgerDbPath } from "./ledger.js";
import { drainProfileBacklog } from "./profile-backlog.js";

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
  signal?: AbortSignal;
  batchSize?: number;
  model?: ModelPort;
  ledger?: Ledger;
  promptStore?: PromptStore;
  profileStore?: ProfileStore;
  /** Profile batches done and planned; called before the first batch and after each one. */
  onProgress?: (done: number, total: number) => void;
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
    if (options.signal?.aborted) break;
    for (const unit of session.units) {
      if (options.signal?.aborted) break;
      const prompt = stripPrivateContent(unit.userPrompt).trim();
      if (
        !prompt ||
        isFullyPrivate(unit.userPrompt) ||
        // OpenCode history already leaves out omms's own capture sessions by title.
        isStructuredSummaryPromptMessage(prompt)
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
  if (options.dryRun || !directory || options.signal?.aborted) return report;

  const user = getTags(directory).user;
  if (!user.userEmail) {
    report.remaining = await prompts.countUnanalyzedForUserLearning();
    report.error = "Profile import needs a user email";
    return report;
  }
  const planned = (waiting: number) => Math.ceil(waiting / batchSize);
  options.onProgress?.(0, planned(await prompts.countUnanalyzedForUserLearning()));
  const drained = await drainProfileBacklog({
    ...(options.onProgress
      ? {
          onProgress: ({ batchesBuilt, remaining }: { batchesBuilt: number; remaining: number }) =>
            options.onProgress!(batchesBuilt, batchesBuilt + planned(remaining)),
        }
      : {}),
    user: { ...user, userEmail: user.userEmail },
    model: options.model!,
    batchSize,
    signal: options.signal,
    label: "History import",
    promptStore: prompts,
    profileStore: profiles,
  });
  report.batchesBuilt += drained.batchesBuilt;
  report.remaining = drained.remaining;
  if (drained.error) report.error = drained.error;
  return report;
}
