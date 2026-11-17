import { resolveClaudeCodeLiveModel } from "../services/ai/live-model-choice.js";
import { claudeCaptureState, type ClaudeCaptureConfig } from "../services/claude-capture-state.js";
import {
  claimNotice,
  clearNotice,
  firstRunNoticeLines,
  nodeNoticeFs,
  noticeClaimed,
  type FirstRunNoticeConfig,
  type NoticeFs,
} from "../services/first-run-notice.js";
import { webServerUrl } from "../services/web-api-auth.js";
import { missingSettingsText } from "../shared/setting-words.js";

// The user lines a Claude Code `SessionStart` answer carries in `systemMessage`
// (design decisions 11 and 12). The hook shows them to the user; they never go
// into the model context. Callers pass the config.

/** The first-run record key of the capture setup line. Cleared when capture is ready. */
export const CAPTURE_SETUP_KEY = "claude-code-capture-setup";
/** The first-run record key of the Claude Code first-run notice. */
const FIRST_RUN_KEY = "claude-code";

/** The user lines for the hook, and the record keys it confirms once it has shown them. */
export type ClaudeNoticeFields = { systemMessage?: string; noticeKeys?: string[] };

export type ClaudeNoticeConfig = ClaudeCaptureConfig &
  FirstRunNoticeConfig & {
    storagePath: string;
    skillStoragePath?: string;
    webServerHost: string;
    webServerPort: number;
  };

/** One line: capture is off, what is missing in plain words, and the Settings link. */
export function captureSetupLine(config: ClaudeNoticeConfig): string {
  const missing = missingSettingsText(resolveClaudeCodeLiveModel(config).issues);
  const host = config.webServerHost === "0.0.0.0" ? "127.0.0.1" : config.webServerHost;
  const link = `${webServerUrl(host, config.webServerPort)}/settings#settings-section-external-api`;
  return `OMMS memory capture is off until you set the external API (missing: ${missing}). Set it on the Settings page: ${link}`;
}

/**
 * The user lines for one `SessionStart` whose hook asked for them, joined with a
 * newline, and their record keys. Nothing is recorded here: the hook confirms the
 * keys after it has written its answer, so a lost reply shows the lines again.
 * Never throws, so a failed notice cannot stop the retrieval.
 */
export function sessionStartNotices(
  config: ClaudeNoticeConfig,
  fs: NoticeFs = nodeNoticeFs
): ClaudeNoticeFields {
  try {
    return pendingLines(config, fs);
  } catch {
    fs.log?.("claude-notice-failed");
    return {};
  }
}

function pendingLines(config: ClaudeNoticeConfig, fs: NoticeFs): ClaudeNoticeFields {
  const folder = config.skillStoragePath ?? config.storagePath;
  const lines: string[] = [];
  const keys: string[] = [];
  const firstRun = firstRunNoticeLines(config, { loginItem: false });
  if (firstRun.length > 0 && !noticeClaimed(FIRST_RUN_KEY, folder, fs)) {
    lines.push(...firstRun);
    keys.push(FIRST_RUN_KEY);
  }
  const state = claudeCaptureState(config);
  // A ready capture forgets the line, so a later loss of the setup shows it once again.
  if (state === "ready") clearNotice(CAPTURE_SETUP_KEY, folder, fs);
  else if (state === "needs-setup" && !noticeClaimed(CAPTURE_SETUP_KEY, folder, fs)) {
    lines.push(captureSetupLine(config));
    keys.push(CAPTURE_SETUP_KEY);
  }
  return lines.length > 0 ? { systemMessage: lines.join("\n"), noticeKeys: keys } : {};
}

/**
 * `POST /api/claude/notices`: records the lines a hook has shown. Only the known
 * keys count; anything else in the body is ignored. Never throws.
 */
export function confirmShownNotices(
  body: unknown,
  config: Pick<ClaudeNoticeConfig, "storagePath" | "skillStoragePath">,
  fs: NoticeFs = nodeNoticeFs
): { ok: true } {
  const keys = (body as { keys?: unknown } | null)?.keys;
  const folder = config.skillStoragePath ?? config.storagePath;
  for (const key of [FIRST_RUN_KEY, CAPTURE_SETUP_KEY]) {
    if (Array.isArray(keys) && keys.includes(key)) claimNotice(key, folder, fs);
  }
  return { ok: true };
}
