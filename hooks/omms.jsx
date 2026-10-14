import { atom, update } from "claude-code";

import { DESCRIPTION, INPUT_SCHEMA, TOOL, registerMemoryTool } from "./omms-memory-tool.jsx";
import { registerRecall } from "./omms-recall.jsx";
import {
  DEFAULT_HEALTH_URL,
  HEALTH_INTERVAL_MS,
  HEALTH_TIMEOUT_MS,
  LAUNCHER_TIMEOUT_MS,
  STATUS_INTERVAL_MS,
  UPDATE_COMMAND,
  isNewer,
  parseStatus,
  registerStatus,
} from "./omms-status.jsx";

// The OMMS plugin's one module entry, named under `modules` in `hooks.json`.
// Claude Code loads one module path per plugin, and the files it imports with
// it. Each part registers its own hooks, except `session.start`: Claude Code
// allows that hook once per plugin, and its `$` cannot be passed into an
// imported function. So this file owns `session.start` and the work it starts.

// The footer label that `omms-status.jsx` draws. Claude Code reads an atom only
// in the file that declares it, so this file names the same plugin and key.
const label = atom({ plugin: "omms", key: "label" }, { state: "connecting", update: null });

/**
 * Registers the memory tool, in the prompt's tool list from the start: a tool
 * behind tool search lost to the skill's Bash route. A failure is written to the
 * transcript, since a missing tool is otherwise silent. The hooks keep working.
 */
async function registerTool($) {
  try {
    await $.tool.register({
      name: TOOL,
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    });
  } catch (error) {
    // The engine already prefixes the line with the plugin name.
    $.ui.log(
      `could not register the memory tool: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Starts the status label's checks. `kept` outlives one session start. */
function startStatus($, kept) {
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
    if (newer && !kept.toasted.has(newer)) {
      kept.toasted.add(newer);
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
  for (const timer of kept.timers) timer.cancel();
  kept.timers = [
    $.clock.after(0, async () => {
      // Show the web app state at once, on the default URL. The launcher can
      // take a minute on a first `npx` download. Check again once it names the URL.
      const early = checkHealth();
      await refreshStatus();
      await Promise.all([early, checkHealth()]);
    }),
    $.clock.every(HEALTH_INTERVAL_MS, checkHealth),
    $.clock.every(STATUS_INTERVAL_MS, refreshStatus),
  ];
}

export const register = (on) => {
  registerStatus(on);
  registerMemoryTool(on);
  registerRecall(on);

  // Kept outside the hook: a second `session.start` must not double the timers or the toast.
  const kept = { toasted: new Set(), timers: [] };

  on("session.start", async ($, e, next) => {
    // Before `next`, so the first prompt lists the tool.
    await registerTool($);
    const started = await next(e);
    startStatus($, kept);
    return started;
  });
};
