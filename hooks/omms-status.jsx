import { atom, read } from "claude-code";

// OMMS status label for Claude Code 2.1.295 or later, drawn at the right of the
// prompt footer after Claude Code's own mode labels: `● omms: connecting`
// (yellow), `connected` (green), `web app off` or `not installed` (red), plus a
// dim ` · <version> available` when npm has a newer release. It does not use
// `$.ui.status`: Claude Code draws that row with a yellow warning sign.
//
// The module holds no OMMS logic. It asks the plugin's own launcher, the one
// the command hooks run, for the web app's health URL, the running version and
// npm's latest version. It polls the health URL itself. Those checks start from
// the plugin's one `session.start` hook, in `omms.jsx`: Claude Code allows that
// hook once per plugin, and its `$` cannot be passed into an imported function.

export const DEFAULT_HEALTH_URL = "http://127.0.0.1:4747/api/health";
export const HEALTH_INTERVAL_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 3_000;
export const STATUS_INTERVAL_MS = 6 * 60 * 60 * 1000;
// A first `npx` download can take longer than the 30 second default.
export const LAUNCHER_TIMEOUT_MS = 60_000;
export const UPDATE_COMMAND = "claude plugin update omms@omms";
// Claude Code theme keys, so the label follows a light or dark theme.
const COLOURS = {
  connecting: "warning",
  connected: "success",
  "web app off": "error",
  "not installed": "error",
};

// What the footer label draws. A write redraws it. `omms.jsx` writes it.
const label = atom({ plugin: "omms", key: "label" }, { state: "connecting", update: null });

/** True when `latest` is a stable release newer than `current`. A prerelease is never offered. */
export function isNewer(latest, current) {
  const parse = (version) => /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(String(version).trim());
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b || a[4]) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  }
  // Same numbers: a release is newer than a prerelease of it.
  return Boolean(b[4]);
}

/** The status JSON the launcher printed, or null when the copy printed none (an older copy). */
export function parseStatus(stdout) {
  const line = stdout
    .split("\n")
    .map((text) => text.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  try {
    const status = JSON.parse(line);
    if (typeof status.healthUrl !== "string" || typeof status.version !== "string") return null;
    return {
      healthUrl: status.healthUrl,
      version: status.version,
      latest: typeof status.latest === "string" ? status.latest : null,
    };
  } catch {
    return null;
  }
}

export const registerStatus = (on) => {
  on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
    const modes = await next(e);
    const { state, update: newer } = await read($, label);
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="row">
        {modes}
        {e.props.modes.length > 0 && <Text dimColor> · </Text>}
        <Text color={COLOURS[state]}>● omms: {state}</Text>
        {newer && <Text dimColor> · {newer} available</Text>}
      </Box>
    );
  });
};
