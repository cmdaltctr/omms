import {
  claimNotice,
  firstRunNoticeLines,
  nodeNoticeFs,
  noticeClaimed,
  type FirstRunNoticeConfig,
  type NoticeFs,
} from "../../services/first-run-notice.js";

// OpenCode's first-run notice (design decision 14). The terminal interface claims
// it and shows it once. The server plugin has no toast, so it writes the notice
// to the OpenCode log at each start until a terminal interface has shown it.

const KEY = "opencode";

export type OpencodeNoticeConfig = FirstRunNoticeConfig & {
  storagePath: string;
  skillStoragePath?: string;
};

const folderOf = (config: OpencodeNoticeConfig) => config.skillStoragePath ?? config.storagePath;

/** The notice text the first time a terminal interface asks, else null. */
export function claimOpencodeFirstRunNotice(
  config: OpencodeNoticeConfig,
  fs: NoticeFs = nodeNoticeFs
): string | null {
  const lines = firstRunNoticeLines(config, { loginItem: true });
  if (lines.length === 0 || !claimNotice(KEY, folderOf(config), fs)) return null;
  return lines.join("\n");
}

/**
 * The notice text while no terminal interface has shown it, else null. Claims
 * nothing and never throws, so it cannot stop the plugin start.
 */
export function unclaimedOpencodeFirstRunNotice(
  config: OpencodeNoticeConfig,
  fs: NoticeFs = nodeNoticeFs
): string | null {
  try {
    const lines = firstRunNoticeLines(config, { loginItem: true });
    if (lines.length === 0) return null;
    return noticeClaimed(KEY, folderOf(config), fs) ? null : lines.join("\n");
  } catch {
    return null;
  }
}
