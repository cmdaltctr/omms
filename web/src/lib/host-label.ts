export type WebHost = "opencode" | "pi" | "claude-code";

const HOST_LABELS: Record<WebHost, string> = {
  opencode: "OpenCode",
  pi: "Pi",
  "claude-code": "Claude Code",
};

/** The host's display name on the Settings page. Product names are not translated. */
export function hostLabel(host: WebHost): string {
  return HOST_LABELS[host];
}
