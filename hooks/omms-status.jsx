import { atom, read, update } from "claude-code";

// OMMS status label for Claude Code 2.1.287 or later, drawn at the right of the
// prompt footer after Claude Code's own mode labels: `● omms: connecting`
// (yellow), `connected` (green), `web app off` or `not installed` (red), plus a
// dim ` · <version> available` when npm has a newer release. It does not use
// `$.ui.status`: Claude Code draws that row with a yellow warning sign.
//
// The module holds no OMMS logic. It asks the plugin's own launcher, the one
// the command hooks run, for the web app's health URL, the running version and
// npm's latest version. It polls the health URL itself.

const DEFAULT_HEALTH_URL = "http://127.0.0.1:4747/api/health";
const HEALTH_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 3_000;
const STATUS_INTERVAL_MS = 6 * 60 * 60 * 1000;
// A first `npx` download can take longer than the 30 second default.
const LAUNCHER_TIMEOUT_MS = 60_000;
const UPDATE_COMMAND = "claude plugin update omms@omms";
// Claude Code theme keys, so the label follows a light or dark theme.
const COLOURS = {
  connecting: "warning",
  connected: "success",
  "web app off": "error",
  "not installed": "error",
};

// What the footer label draws. A write redraws it.
const label = atom({ plugin: "omms", key: "label" }, { state: "connecting", update: null });

/** True when `latest` is a stable release newer than `current`. A prerelease is never offered. */
function isNewer(latest, current) {
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
function parseStatus(stdout) {
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

export const register = (on) => {
  // Kept outside the hook: a second `session.start` must not double the timers or the toast.
  const toasted = new Set();
  let timers = [];

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

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    const facts = {
      healthUrl: DEFAULT_HEALTH_URL,
      version: null,
      latest: null,
      isInstalled: true,
      web: null,
    };

    const show = async () => {
      if (facts.web === null) return;
      if (!facts.isInstalled) {
        await update($, label, () => ({ state: "not installed", update: null }));
        return;
      }
      const state = facts.web ? "connected" : "web app off";
      const newer =
        facts.version && facts.latest && isNewer(facts.latest, facts.version) ? facts.latest : null;
      await update($, label, () => ({ state, update: newer }));
      if (newer && !toasted.has(newer)) {
        toasted.add(newer);
        $.ui.toast(`OMMS ${newer} is available. Run: ${UPDATE_COMMAND}, then /reload-plugins`);
      }
    };

    // A slow answer from an earlier check must not overwrite a newer one.
    let healthRun = 0;
    const checkHealth = async () => {
      const run = ++healthRun;
      const answer = async () => {
        try {
          const response = await $.http.fetch(facts.healthUrl);
          if (response.status === 401) return true;
          return response.ok && JSON.parse(response.text).success === true;
        } catch {
          return false;
        }
      };
      const timeout = $.clock.sleep(HEALTH_TIMEOUT_MS).then(() => false);
      const web = await Promise.race([answer(), timeout]);
      if (run !== healthRun) return;
      facts.web = web;
      await show();
    };

    const refreshStatus = async () => {
      try {
        const run = await $.process.run(
          [
            "node",
            `${$.plugin.root}/bin/omms-launch.mjs`,
            "--at-least-own-version",
            "claude-hook",
            "status",
          ],
          { timeoutMs: LAUNCHER_TIMEOUT_MS }
        );
        facts.isInstalled = run.exitCode === 0;
        const status = facts.isInstalled ? parseStatus(run.stdout) : null;
        // An older copy prints nothing: keep the default health URL, check no update.
        facts.healthUrl = status ? status.healthUrl : DEFAULT_HEALTH_URL;
        facts.version = status ? status.version : null;
        facts.latest = status ? status.latest : null;
      } catch (error) {
        // A start failure means Node.js is missing. Any other rejection is the
        // 60 second timeout: keep the health-only state and try again later.
        facts.isInstalled = !String(error && error.message).includes("failed to start");
        facts.latest = null;
      }
      await show();
    };

    // The timers outlive this hook, so a slow first download never delays the session.
    for (const timer of timers) timer.cancel();
    timers = [];
    timers.push(
      $.clock.after(0, async () => {
        // Show the web app state at once, on the default URL. The launcher can
        // take a minute on a first `npx` download. Check again once it names the URL.
        const early = checkHealth();
        await refreshStatus();
        await Promise.all([early, checkHealth()]);
      }),
      $.clock.every(HEALTH_INTERVAL_MS, checkHealth),
      $.clock.every(STATUS_INTERVAL_MS, refreshStatus)
    );
    return started;
  });
};
