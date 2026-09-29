import type { MemoryHost } from "./index.js";

const HOST_LABELS: Record<MemoryHost, string> = {
  opencode: "OpenCode",
  pi: "Pi",
  "claude-code": "Claude Code",
};

/** The host's display name in messages and reports. */
export function hostLabel(host: MemoryHost): string {
  return HOST_LABELS[host];
}
