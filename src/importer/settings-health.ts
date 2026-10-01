import { CONFIG } from "../config.js";
import {
  getAutoCaptureProviderStatus,
  resolvePiLiveModel,
} from "../services/ai/live-model-choice.js";
import { isLoopbackHost } from "../services/web-api-auth.js";
import { safeHealthError } from "../services/safe-health-error.js";
export { safeHealthError } from "../services/safe-health-error.js";

export type HealthRow = { check: string; status: "pass" | "warn" | "fail"; reason: string };
const PROBE = "Reply with a short acknowledgement.";

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
          : (model.issues ?? []).join("; ") || "External API is not configured",
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
      checks.push({
        check: name,
        status: "fail",
        reason: safeHealthError(error, [
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
    snapshot = (getSettingsSnapshot(input.directory) ?? {}) as ClaudeSnapshot;
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
    reason: opencode.ready ? `Resolved: ${opencode.mode}` : opencode.issues.join("; "),
  });
  const pi = resolvePiLiveModel(CONFIG);
  checks.push({
    check: "Pi model",
    status: pi.kind === "unready" ? "fail" : "pass",
    reason: pi.kind === "unready" ? pi.issues.join("; ") : `Resolved: ${pi.kind}`,
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
      });
    }
    if (snapshot.effective?.["claude-code"]?.ready) {
      await check("Claude Code model test", async () => {
        await probeExternal();
        return "Fixed prompt completed";
      });
    }
  }
  return { checks };
}
