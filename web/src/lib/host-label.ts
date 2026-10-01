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

/** A host id from the server as its display name; an unknown id is shown as sent. */
export function hostName(host: string): string {
  return Object.hasOwn(HOST_LABELS, host) ? HOST_LABELS[host as WebHost] : host;
}
