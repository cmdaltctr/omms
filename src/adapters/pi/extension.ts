import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG, initConfig, isConfigured } from "../../config.js";
import { executeMemoryOperation } from "../../core/memory-operations.js";
import { getLanguageName } from "../../services/language-detector.js";
import { log } from "../../services/logger.js";
import { memoryClient } from "../../services/client.js";
import { capturePiSettledWorkUnit, createPiCaptureState } from "./capture.js";
import type { PiSessionEntry } from "./conversation.js";
import { createPiCaptureProvider, type PiModelHandle } from "./provider.js";
import { buildPiRetrievalSection } from "./retrieval.js";

const GLOBAL_PLUGIN_WARMUP_KEY = Symbol.for("opencode-mem.plugin.warmedup");

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

/**
 * Pi extension entry point for the shared opencode-mem engine.
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
export default function opencodeMemPiExtension(pi: ExtensionAPI): void {
  let captureState = createPiCaptureState();

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

  const resolveModel = (ctx: ExtensionContext): PiModelHandle | null => {
    const registry = ctx.modelRegistry as any;
    if (!registry) return null;

    let model: any = null;
    if (CONFIG.piProvider && CONFIG.piModel) {
      model = registry.find(CONFIG.piProvider, CONFIG.piModel) ?? null;
    }
    if (!model) model = ctx.model ?? null;
    if (!model) return null;

    return {
      provider: typeof model.provider === "string" ? model.provider : "unknown",
      modelId:
        typeof model.id === "string"
          ? model.id
          : typeof model.modelId === "string"
            ? model.modelId
            : "unknown",
      complete: (context: Parameters<typeof registry.complete>[1]) =>
        registry.complete(model, context),
    };
  };

  pi.on("session_start", async (_event, ctx) => {
    try {
      initConfig(ctx.cwd);
      captureState = createPiCaptureState();

      const globalScope = globalThis as any;
      if (!globalScope[GLOBAL_PLUGIN_WARMUP_KEY] && isConfigured()) {
        (async () => {
          try {
            await memoryClient.warmup();
            globalScope[GLOBAL_PLUGIN_WARMUP_KEY] = true;
          } catch (error) {
            log("Pi plugin memory warmup failed", { error: String(error) });
          }
        })();
      }
    } catch (error) {
      log("Pi session_start error", { error: String(error) });
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isConfigured() || !CONFIG.chatMessage.enabled) return;

    try {
      const section = await buildPiRetrievalSection(
        event.prompt,
        ctx.cwd,
        ctx.sessionManager.getSessionId()
      );
      if (!section) return;

      return {
        systemPrompt:
          event.systemPrompt +
          "\n\n" +
          "<opencode-mem-retrieval>\n" +
          section +
          "\n</opencode-mem-retrieval>",
      };
    } catch (error) {
      log("Pi before_agent_start retrieval error", { error: String(error) });
      return undefined;
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!isConfigured()) return;

    try {
      const entries = toSessionEntries(ctx.sessionManager.getBranch());
      const provider = createPiCaptureProvider(() => resolveModel(ctx));

      await capturePiSettledWorkUnit({
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
    } catch (error) {
      log("Pi agent_settled error", { error: String(error) });
    }
  });

  pi.on("session_shutdown", async () => {
    captureState = createPiCaptureState();
    (globalThis as any)[GLOBAL_PLUGIN_WARMUP_KEY] = false;
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
    description: `Manage and query project memory (MATCH USER LANGUAGE: ${getLanguageName(
      CONFIG.autoCaptureLanguage || "en"
    )}). Use 'search' with technical keywords/tags, 'add' to store knowledge, 'profile' for preferences. Use migrate/list-shards/export/import when a project directory moves. Search/list scope: project or all-projects.`,
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
}
