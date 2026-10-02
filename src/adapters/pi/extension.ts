import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  CONFIG,
  initConfigWithLegacyMigration,
  isConfigured,
  refreshConfigIfChanged,
} from "../../config.js";
import { pruneTraces } from "../../services/capture-diagnostics.js";
import { executeMemoryOperation } from "../../core/memory-operations.js";
import { memoryToolDescription } from "../../core/memory-tool-text.js";
import { isTrivialPrompt } from "../../core/trivial-prompt.js";
import { getLanguageName } from "../../services/language-detector.js";
import { log } from "../../services/logger.js";
import { memoryClient } from "../../services/client.js";
import { capturePiSettledWorkUnit, createPiCaptureState } from "./capture.js";
import type { PiSessionEntry } from "../../importer/pi-conversation.js";
import { createPiLiveModels } from "./live-model.js";
import { registerPiHistoryImportCommand } from "./import-command.js";
import { performPiProfileLearning } from "./profile.js";
import { buildRetrievalSection, wrapRetrievalSection } from "../../core/retrieval.js";

const GLOBAL_PLUGIN_WARMUP_KEY = Symbol.for("omms.plugin.warmedup");
const GLOBAL_PI_BACKFILL_KEY = Symbol.for("omms.pi.backfill.scheduled");
const OMMS_STATUS_KEY = "omms";
type PiBackfillTask = { controller: AbortController; promise: Promise<void> };

type OmmsStatus = "warming" | "connected" | "recalling" | "capturing" | "error";

const MEMORY_TOOL_MODES = [
  "add",
  "search",
  "profile",
  "list",
  "forget",
  "help",
  "migrate",
  "list-shards",
  "export",
  "import",
] as const;

function toSessionEntries(branch: unknown): PiSessionEntry[] {
  return Array.isArray(branch) ? (branch as PiSessionEntry[]) : [];
}

function lastSettledUserPrompt(entries: PiSessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text) return text;
    }
    return null;
  }
  return null;
}

/**
 * Pi extension entry point for the shared omms engine.
 *
 * Lifecycle mapping:
 * - `session_start`        -> load shared config for ctx.cwd, warm storage
 * - `before_agent_start`   -> prompt-aware semantic retrieval, injected as a
 *                             delimited system-prompt section (never a fake
 *                             user message)
 * - `agent_settled`        -> automatic capture of the settled work unit
 * - `session_shutdown`     -> idempotent session-scoped cleanup
 * - `memory` tool          -> shared add/search/profile/list/forget/help and
 *                             portability operations
 *
 * Pi types are imported type-only: the compiled extension carries no Pi
 * runtime dependency and uses the host Pi runtime provided at load time.
 */
export default function ommsPiExtension(pi: ExtensionAPI): void {
  let captureState = createPiCaptureState();
  let promptsSinceProfileAnalysis: string[] = [];
  // Latest session context, refreshed on session_start and consumed by the
  // import command (command contexts do not expose the model registry).
  let latestCtx: ExtensionContext | null = null;
  let backfillSessionId: string | null = null;
  let statusVersion = 0;

  const startStatus = (ctx: ExtensionContext, status: OmmsStatus): number => {
    const version = ++statusVersion;
    if (ctx.hasUI) ctx.ui.setStatus(OMMS_STATUS_KEY, `omms:${status}`);
    return version;
  };

  const finishStatus = (
    ctx: ExtensionContext,
    version: number,
    status: "connected" | "error"
  ): void => {
    if (version !== statusVersion || !ctx.hasUI) return;
    ctx.ui.setStatus(OMMS_STATUS_KEY, `omms:${status}`);
  };

  const clearStatus = (ctx: ExtensionContext): void => {
    statusVersion++;
    if (ctx.hasUI) ctx.ui.setStatus(OMMS_STATUS_KEY, undefined);
  };

  const notify =
    (ctx: ExtensionContext) =>
    (notification: {
      title: string;
      message: string;
      variant: "success" | "warning" | "error" | "info";
    }) => {
      if (!ctx.hasUI) return;
      const level: "error" | "warning" | "info" =
        notification.variant === "success" ? "info" : notification.variant;
      ctx.ui.notify(`${notification.title}: ${notification.message}`, level);
    };

  pi.on("session_start", async (_event, ctx) => {
    const status = startStatus(ctx, "warming");
    try {
      latestCtx = ctx;
      initConfigWithLegacyMigration(ctx.cwd);
      // Runs even with tracing off, so turning it off does not leave old traces behind.
      pruneTraces(CONFIG);
      captureState = createPiCaptureState();
      // Record this copy first: the login item and the other hosts run the newest recorded copy.
      void import("../../services/runtime-handoff.js")
        .then(({ registerOwnCopy }) => registerOwnCopy())
        .catch((error: unknown) =>
          log("Pi runtime record failed", { code: error instanceof Error ? error.name : "unknown" })
        );
      if (
        CONFIG.webServerAutoStart !== undefined &&
        process.env.OMMS_DISABLE_WEB_AUTOSTART !== "1"
      ) {
        void import("../../services/web-autostart.js")
          .then(({ reconcileWebAutostart }) => reconcileWebAutostart(CONFIG))
          .catch((error: unknown) =>
            log("Pi login item reconciliation failed", {
              code: error instanceof Error ? error.name : "unknown",
            })
          );
      }
      if (process.env.OMMS_DISABLE_WEB_AUTOSTART !== "1") {
        // Start the shared web app if none runs. The session does not wait for it.
        void Promise.all([
          import("../../services/web-ensure.js"),
          import("../../services/web-api-auth.js"),
          import("../../services/runtime-handoff.js"),
        ])
          .then(async ([{ ensureWebApp }, { webServerUrl }, { hostReplaceOlder }]) => {
            // A web app older than the newest recorded copy steps aside for it.
            const replaceOlder = await hostReplaceOlder().catch(() => undefined);
            return ensureWebApp({
              settings: {
                enabled: CONFIG.webServerEnabled,
                baseUrl: webServerUrl(CONFIG.webServerHost, CONFIG.webServerPort),
              },
              budgetMs: 0,
              wait: false,
              ...(replaceOlder ? { replaceOlder } : {}),
            });
          })
          .catch((error: unknown) =>
            log("Pi web app start failed", {
              code: error instanceof Error ? error.name : "unknown",
            })
          );
      }

      // Retry turns whose capture failed earlier, with this session's capture model.
      void import("../../services/capture-retry-drain.js")
        .then(({ drainCaptureRetries, registerCaptureRetryDrain, startCaptureRetryDrain }) => {
          registerCaptureRetryDrain("pi", () => {
            // A retention change in the config file applies from this pass on.
            refreshConfigIfChanged(ctx.cwd);
            return drainCaptureRetries({
              host: "pi",
              provider: createPiLiveModels(ctx, notify(ctx)).capture,
              config: CONFIG,
              isReady: () => isConfigured() && !memoryClient.getEmbeddingInitError?.(),
            });
          });
          if (isConfigured() && CONFIG.autoCaptureEnabled) startCaptureRetryDrain("pi");
        })
        .catch(() => {});

      // Run now on a Settings page served by this process can use Pi's signed-in models.
      void Promise.all([
        import("../../importer/backfill-controls.js"),
        import("./backfill-models.js"),
      ])
        .then(([{ registerHostBackfillModels }, { resolvePiBackfillModels }]) =>
          registerHostBackfillModels("pi", () => resolvePiBackfillModels(ctx))
        )
        .catch(() => {});

      const globalScope = globalThis as any;
      const sessionId = ctx.sessionManager.getSessionId();
      if (
        isConfigured() &&
        CONFIG.autoBackfill &&
        process.env.OMMS_DISABLE_AUTO_BACKFILL !== "1" &&
        !globalScope[GLOBAL_PI_BACKFILL_KEY] &&
        backfillSessionId !== sessionId
      ) {
        backfillSessionId = sessionId;
        const controller = new AbortController();
        const task: PiBackfillTask = { controller, promise: Promise.resolve() };
        globalScope[GLOBAL_PI_BACKFILL_KEY] = task;
        task.promise = (async () => {
          const { scheduleAutoBackfill } = await import("../../importer/auto-backfill.js");
          await scheduleAutoBackfill({
            host: "pi",
            cwd: ctx.cwd,
            signal: controller.signal,
            resolveModels: async () => {
              const { resolvePiBackfillModels } = await import("./backfill-models.js");
              return resolvePiBackfillModels(ctx);
            },
            notify: (message) => {
              if (!controller.signal.aborted && ctx.hasUI) ctx.ui.notify(message, "info");
            },
          });
        })()
          .catch((error: unknown) =>
            log("Pi backfill failed", {
              error: error instanceof Error ? error.message : String(error),
            })
          )
          .finally(() => {
            if (globalScope[GLOBAL_PI_BACKFILL_KEY] === task) {
              delete globalScope[GLOBAL_PI_BACKFILL_KEY];
            }
          });
      }
      if (!globalScope[GLOBAL_PLUGIN_WARMUP_KEY] && isConfigured()) {
        (async () => {
          try {
            await memoryClient.warmup();
            globalScope[GLOBAL_PLUGIN_WARMUP_KEY] = true;
            finishStatus(ctx, status, "connected");
          } catch (error) {
            log("Pi plugin memory warmup failed", { error: String(error) });
            finishStatus(ctx, status, "error");
          }
        })();
      } else {
        finishStatus(ctx, status, "connected");
      }
    } catch (error) {
      log("Pi session_start error", { error: String(error) });
      finishStatus(ctx, status, "error");
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isConfigured() || !CONFIG.chatMessage.enabled) return;

    const status = startStatus(ctx, "recalling");
    try {
      const section = await buildRetrievalSection(
        event.prompt,
        ctx.cwd,
        ctx.sessionManager.getSessionId()
      );
      finishStatus(ctx, status, "connected");
      if (!section) return;

      return {
        systemPrompt: event.systemPrompt + "\n\n" + wrapRetrievalSection(section),
      };
    } catch (error) {
      log("Pi before_agent_start retrieval error", { error: String(error) });
      finishStatus(ctx, status, "error");
      return undefined;
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!isConfigured()) return;

    const status = startStatus(ctx, "capturing");
    try {
      const entries = toSessionEntries(ctx.sessionManager.getBranch());
      const liveModels = createPiLiveModels(ctx, notify(ctx));
      const provider = liveModels.capture;

      const captureResult = await capturePiSettledWorkUnit({
        sessionId: ctx.sessionManager.getSessionId(),
        directory: ctx.cwd,
        entries,
        provider,
        state: captureState,
        prompt: {
          providerId: (ctx.model as any)?.provider ?? null,
          modelId: (ctx.model as any)?.id ?? null,
        },
        notify: notify(ctx),
      });

      const settledPrompt = lastSettledUserPrompt(entries);
      // Pi batches this session's prompts in memory, so they are recent by design.
      if (
        settledPrompt &&
        !isTrivialPrompt(settledPrompt) &&
        CONFIG.userProfileAnalysisInterval > 0 &&
        !memoryClient.getEmbeddingInitError?.()
      ) {
        promptsSinceProfileAnalysis.push(settledPrompt);
        if (promptsSinceProfileAnalysis.length >= CONFIG.userProfileAnalysisInterval) {
          const batch = promptsSinceProfileAnalysis;
          promptsSinceProfileAnalysis = [];
          await performPiProfileLearning({
            directory: ctx.cwd,
            prompts: batch,
            resolveProfileModel: liveModels.profile,
            notify: notify(ctx),
          });
        }
      }

      finishStatus(ctx, status, captureResult.status === "failed" ? "error" : "connected");
    } catch (error) {
      log("Pi agent_settled error", { error: String(error) });
      finishStatus(ctx, status, "error");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearStatus(ctx);
    latestCtx = null;
    captureState = createPiCaptureState();
    promptsSinceProfileAnalysis = [];
    (globalThis as any)[GLOBAL_PLUGIN_WARMUP_KEY] = false;
    const task = (globalThis as any)[GLOBAL_PI_BACKFILL_KEY] as PiBackfillTask | undefined;
    task?.controller.abort();
    if (task) await task.promise;
    backfillSessionId = null;
    try {
      await memoryClient.close();
    } catch {
      // Idempotent cleanup: closing an already-closed client must never fail
      // the shutdown flow across quit, reload, new, resume, and fork.
    }
  });

  pi.registerTool({
    name: "memory",
    label: "Memory",
    description: memoryToolDescription(getLanguageName(CONFIG.autoCaptureLanguage || "en")),
    parameters: Type.Object({
      mode: Type.Optional(Type.Union(MEMORY_TOOL_MODES.map((mode) => Type.Literal(mode)))),
      content: Type.Optional(Type.String()),
      query: Type.Optional(Type.String()),
      tags: Type.Optional(Type.String()),
      type: Type.Optional(Type.String()),
      memoryId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("all-projects")])),
      fromPath: Type.Optional(Type.String()),
      fromHash: Type.Optional(Type.String()),
      outputPath: Type.Optional(Type.String()),
      inputPath: Type.Optional(Type.String()),
      dryRun: Type.Optional(Type.Boolean()),
      allowLinkedSource: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, args, _signal, _onUpdate, ctx) {
      const result = await executeMemoryOperation(args as any, {
        directory: ctx.cwd,
        host: "pi",
        hostSessionId: ctx.sessionManager.getSessionId(),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  });

  registerPiHistoryImportCommand(pi, () => latestCtx);
}
