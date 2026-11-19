import { CONFIG, refreshConfigIfChanged } from "../../config.js";
import {
  runProfileLearningPass,
  type ProfileLearningPassResult,
} from "../../core/profile-learning/pass.js";
import { log } from "../../services/logger.js";
import { createOpencodeLearningModel } from "./profile-model.js";
import { showOpencodeNotice, type OpencodeNotice } from "./toast.js";

// OpenCode's profile learning trigger. The steps live in the shared pass
// (change unify-profile-learning, design D1); OpenCode keeps the model and the notice.

/**
 * Run one learning pass for `directory` after an idle capture. Never throws. `notify` shows the
 * pass's notices; the V2 plugin passes the TUI channel (`registerTuiNotices`).
 */
export async function performUserProfileLearning(
  directory: string,
  notify: (notice: OpencodeNotice) => void = showOpencodeNotice
): Promise<ProfileLearningPassResult> {
  refreshConfigIfChanged(directory);
  if (!CONFIG.autoCaptureProviderStatus?.ready) {
    log(
      "user-profile-learning: skipped (provider not ready)",
      { issues: CONFIG.autoCaptureProviderStatus?.issues ?? ["status undefined"] },
      "warn"
    );
    return { outcome: "skipped" };
  }
  // A copy taken right after the refresh: a config edit during the pass must not change
  // its limits. The next pass reads the new values.
  const config = { ...CONFIG };
  return runProfileLearningPass({
    host: "opencode",
    directory,
    config,
    model: () => createOpencodeLearningModel(notify),
    notify,
  });
}
