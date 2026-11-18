import { CONFIG } from "../config.js";
import {
  externalModelIssues,
  getAutoCaptureProviderStatus,
  resolvePiLiveModel,
} from "../services/ai/live-model-choice.js";
import { isLoopbackHost } from "../services/web-api-auth.js";
import { HOSTS, hostLabel, type MemoryHost } from "../shared/hosts.js";
import { missingSettingsText } from "../shared/setting-words.js";
import { safeHealthError } from "../services/safe-health-error.js";
export { safeHealthError } from "../services/safe-health-error.js";

export type HealthRow = {
  check: string;
  status: "pass" | "warn" | "fail";
  reason: string;
  /** The host a row belongs to; absent for a row about the whole machine. */
  host?: MemoryHost;
  /** Plain words to fix a row that is not a pass. */
  fix?: string;
  /** True for a model test the web app cannot run: the host uses its own model. `doctor` skips it. */
  hostModelOnly?: true;
};
const PROBE = "Reply with a short acknowledgement.";

const ROW_HOSTS = HOSTS.map((host) => [`${hostLabel(host)} `, host] as const);

/** The external API settings still missing, in plain words; host model issues are left out. */
function externalApiReason(issues: string[]): string {
  const words = missingSettingsText(issues.filter((issue) => issue.startsWith("memory")));
  return words ? `The external API is missing: ${words}.` : "The external API is not set up.";
}

const SETTINGS_API = "fill in the External API card on the Settings page";
const ROW_FIXES: Record<string, string> = {
  "Config files": "Fix the config file named in the reason. The Settings page shows the error too.",
  "Memory store": "Check that the OMMS storage folder exists and that you can write to it.",
  Embedding:
    "Open the Embedding card on the Settings page. Without an embedding API URL, OMMS downloads a local model once and needs internet access for it.",
  "Web binding":
    'Set "webServerHost" back to 127.0.0.1, or create an API token or a browser password on the Settings page.',
  "OpenCode model": `Choose an OpenCode model on the Settings page, or ${SETTINGS_API}.`,
  "Pi model": `Choose a Pi model on the Settings page, or ${SETTINGS_API}.`,
  "Claude Code model": `Claude Code capture needs the external API: ${SETTINGS_API}.`,
  "Claude Code folder":
    'Start Claude Code once so it creates its folder, or set "claudeConfigDir" in the global config.',
  "Capture failures (24 hours)":
    "Open the Settings page to see why captures failed, then check the model and its key.",
  "OpenCode model test": `Run a capture in OpenCode, or check the model on the Settings page.`,
  "Pi model test": `Start a Pi session to test a Pi model, or ${SETTINGS_API}.`,
  "Claude Code model test":
    "Check the URL, model and key in the External API card on the Settings page.",
};

/** Adds the row's host and, for a row that is not a pass, the fix. */
function withHostAndFix(row: HealthRow): HealthRow {
  const host = ROW_HOSTS.find(([prefix]) => row.check.startsWith(prefix))?.[1];
  return {
    ...row,
    ...(host ? { host } : {}),
    ...(row.status === "pass"
      ? {}
      : { fix: ROW_FIXES[row.check] ?? "Open the Settings page for details." }),
  };
}

async function createOpencodeImportModels(
  ref: { providerID: string; modelID: string },
  directory: string
) {
  const { getOpencodeHostModels } = await import("./backfill-controls.js");
  const opencode = getOpencodeHostModels();
  if (!opencode) throw new Error("the OpenCode client is not ready; retry in a moment");
  return opencode.createImportModels(ref, directory);
}

export function captureFailureHealth(
  byModel: Array<{ total: number; failed: number }>,
  byReason: Array<{ reason: string; count: number }>
): HealthRow {
  const total = byModel.reduce((count, row) => count + row.total, 0);
  const failed = byModel.reduce((count, row) => count + row.failed, 0);
  const reason = [...byReason].sort((a, b) => b.count - a.count)[0]?.reason;
  return {
    check: "Capture failures (24 hours)",
    status: total > 0 && failed / total > 0.2 ? "warn" : "pass",
    reason: total
      ? `${failed}/${total} failed${reason ? `; most common reason: ${reason}` : ""}`
      : "No recent attempts",
  };
}

type ClaudeSnapshot = {
  effective?: { "claude-code"?: { ready: boolean; issues?: string[] } };
  claudeFolder?: { root: string; exists: boolean };
};

/** Claude Code rows from the settings snapshot; missing data is a failure, never a throw. */
function claudeCodeRows(snapshot: ClaudeSnapshot): HealthRow[] {
  const model = snapshot.effective?.["claude-code"];
  const folder = snapshot.claudeFolder;
  return [
    {
      check: "Claude Code model",
      status: model?.ready ? "pass" : "fail",
      reason: !model
        ? "Claude Code model status is unavailable"
        : model.ready
          ? "Resolved: external API"
          : externalApiReason(model.issues ?? []),
    },
    {
      check: "Claude Code folder",
      status: !folder ? "fail" : folder.exists ? "pass" : "warn",
      reason: !folder
        ? "Claude Code folder status is unavailable"
        : folder.exists
          ? `Found: ${folder.root}`
          : `Folder not found: ${folder.root}`,
    },
  ];
}

export interface HealthInput {
  directory: string;
  host: string;
  authEnabled: boolean;
  apiTokenSet: boolean;
  testModels: boolean;
}

/** Run checks independently so a failed dependency cannot hide the remaining checks. */
export async function runSettingsHealth(input: HealthInput): Promise<{ checks: HealthRow[] }> {
  const checks: HealthRow[] = [];
  async function check(name: string, action: () => Promise<string>): Promise<void> {
    try {
      checks.push({ check: name, status: "pass", reason: await action() });
    } catch (error) {
      // The model selection error names a config key ("Missing memoryModel or --model").
      const missingSetting = error instanceof Error && error.message.startsWith("Missing memory");
      checks.push({
        check: name,
        status: "fail",
        reason: missingSetting
          ? externalApiReason(externalModelIssues(CONFIG))
          : safeHealthError(error, [
              CONFIG.memoryApiKey,
              CONFIG.embeddingApiKey,
              CONFIG.webServerApiToken,
            ]),
      });
    }
  }
  let snapshot: ClaudeSnapshot = {};
  await check("Config files", async () => {
    const { getSettingsSnapshot } = await import("../services/settings-snapshot.js");
    snapshot = (getSettingsSnapshot(input.directory, await import("../config.js")) ??
      {}) as ClaudeSnapshot;
    return "Global and project config parsed";
  });
  await check("Memory store", async () => {
    const { tursoConnectionManager } = await import("../services/turso/connection-manager.js");
    const { join } = await import("node:path");
    const db = await tursoConnectionManager.getConnection(
      join(CONFIG.storagePath, "user-prompts.db")
    );
    await db.all("SELECT 1");
    return "Store opened and queried";
  });
  await check("Embedding", async () => {
    const { embeddingService } = await import("../services/embedding.js");
    const result = await embeddingService.embedWithTimeout("OMMS health check", { task: "query" });
    if (!result.length) throw new Error("Embedding returned no values");
    return "Test text embedded";
  });
  const secure = isLoopbackHost(input.host) || input.authEnabled || input.apiTokenSet;
  checks.push({
    check: "Web binding",
    status: secure ? "pass" : "fail",
    reason: secure
      ? "Binding and access settings are safe"
      : "Network binding requires an API token or Basic Auth",
  });
  const opencode = getAutoCaptureProviderStatus(CONFIG);
  checks.push({
    check: "OpenCode model",
    status: opencode.ready ? "pass" : "fail",
    reason: opencode.ready ? `Resolved: ${opencode.mode}` : externalApiReason(opencode.issues),
  });
  const pi = resolvePiLiveModel(CONFIG);
  checks.push({
    check: "Pi model",
    status: pi.kind === "unready" ? "fail" : "pass",
    reason: pi.kind === "unready" ? externalApiReason(pi.issues) : `Resolved: ${pi.kind}`,
  });
  checks.push(...claudeCodeRows(snapshot));
  try {
    const { queryCaptureAttempts } = await import("../services/capture-attempt-store.js");
    const { byModel, byReason } = await queryCaptureAttempts(Date.now() - 86400000, Date.now());
    checks.push(
      captureFailureHealth(
        byModel,
        byReason.map((row) => ({ count: row.count, reason: String(row.reason) }))
      )
    );
  } catch (error) {
    checks.push({
      check: "Capture failures (24 hours)",
      status: "fail",
      reason: safeHealthError(error, [CONFIG.memoryApiKey]),
    });
  }
  if (input.testModels) {
    // Pi, Claude Code, and OpenCode may all use the external API; one health run calls it once.
    let externalProbe: Promise<void> | undefined;
    const probeExternal = () =>
      (externalProbe ??= import("./model-selection.js").then(async ({ selectImportModel }) => {
        await selectImportModel({}).capture.summarize({
          userPrompt: PROBE,
          context: PROBE,
          sessionId: "health",
          projectDirectory: input.directory,
        });
      }));
    const { resolveOpencodeHostModel } = await import("../services/ai/live-model-choice.js");
    const { getOpencodeHostModels } = await import("./backfill-controls.js");
    const opencodeRef = resolveOpencodeHostModel(CONFIG);
    if (opencodeRef && !getOpencodeHostModels()) {
      // The web app runs outside OpenCode, so an OpenCode signed-in model cannot be called here.
      checks.push({
        check: "OpenCode model test",
        status: "warn",
        reason:
          "Skipped: an OpenCode signed-in model can be tested only inside OpenCode. Run a capture in OpenCode, or set the external API as the capture model.",
        hostModelOnly: true,
      });
    } else {
      await check("OpenCode model test", async () => {
        if (!opencodeRef) {
          await probeExternal();
          return "Fixed prompt completed";
        }
        const { capture } = await createOpencodeImportModels(opencodeRef, input.directory);
        await capture.summarize({
          userPrompt: PROBE,
          context: PROBE,
          sessionId: "health",
          projectDirectory: input.directory,
        });
        return "Fixed prompt completed";
      });
    }
    if (pi.kind === "manual") {
      await check("Pi model test", async () => {
        await probeExternal();
        return "Fixed prompt completed";
      });
    } else {
      checks.push({
        check: "Pi model test",
        status: "warn",
        reason: "Pi models need an active Pi session to test",
        ...(pi.kind === "unready" ? {} : { hostModelOnly: true as const }),
      });
    }
    if (snapshot.effective?.["claude-code"]?.ready) {
      await check("Claude Code model test", async () => {
        await probeExternal();
        return "Fixed prompt completed";
      });
    }
  }
  return { checks: checks.map(withHostAndFix) };
}
