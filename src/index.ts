import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";

import { memoryClient } from "./services/client.js";
import { getTags } from "./services/tags.js";
import { performAutoCapture } from "./services/auto-capture.js";
import { createOpenCodeAutoCaptureHost } from "./adapters/opencode/auto-capture-host.js";
import {
  isInternalPrompt,
  isStructuredSummaryPromptMessage,
  recordUserPrompt,
} from "./adapters/opencode/user-prompt.js";
import { executeMemoryOperation, type MemoryOperationArgs } from "./core/memory-operations.js";
import { memoryToolDescription } from "./core/memory-tool-text.js";
import {
  OPENCODE_IMPORT_COMMAND,
  OPENCODE_IMPORT_DESCRIPTION,
  latestUserMessageModel,
  runOpencodeImportCommand,
} from "./adapters/opencode/import-command.js";
import { buildRecentMemoriesSection, formatMemoriesForCompaction } from "./core/retrieval.js";
import { performUserProfileLearning } from "./adapters/opencode/profile-learning.js";
import { userPromptManager } from "./services/user-prompt/user-prompt-manager.js";
import { pruneTraces } from "./services/capture-diagnostics.js";
import { ensureTursoReady } from "./services/turso/ready.js";
import { tursoConnectionManager } from "./services/turso/connection-manager.js";

import { isConfigured, CONFIG, initConfigWithLegacyMigration } from "./config.js";
import { resolveOpencodeHostModel } from "./services/ai/live-model-choice.js";
import { log } from "./services/logger.js";
import { getLanguageName } from "./services/language-detector.js";
import { getHostClientConfig } from "./adapters/opencode/opencode-host-config.js";
import { applySkillsPathConfig } from "./adapters/opencode/package-skills.js";
import { loadOpencodeProvider } from "./adapters/opencode/opencode-provider-loader.js";
import {
  STRUCTURED_OUTPUT_AGENT,
  STRUCTURED_OUTPUT_TOOLS,
} from "./adapters/opencode/opencode-provider.js";

import {
  INTERNAL_CAPTURE_SESSION_TITLE,
  isInternalCaptureSessionTitle,
  isTrackedInternalCaptureSession,
} from "./adapters/opencode/internal-capture-sessions.js";
import { registerOpencodeProfileModel } from "./adapters/opencode/profile-model.js";

export { INTERNAL_CAPTURE_SESSION_TITLE, isInternalCaptureSessionTitle };
export { isStructuredSummaryPromptMessage };

function extractSessionTitle(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const obj = response as {
    data?: { title?: string };
    title?: string;
  };
  return obj.data?.title ?? obj.title;
}

function unwrapSdkData<T>(response: unknown): T | undefined {
  if (!response || typeof response !== "object") return undefined;
  const obj = response as { data?: T };
  return (obj.data ?? response) as T;
}

/**
 * Resolve the session's active agent so compaction memory injection does not
 * reset OpenCode to the stock "general-purpose" fallback (issue #236).
 *
 * Preference order:
 * 1. session.get().agent (v2 hosts)
 * 2. Latest non-compaction user message agent
 * 3. Latest non-compaction / non-summary assistant mode (v1) or agent (v2)
 */
export async function resolveSessionAgent(
  client: unknown,
  sessionID: string
): Promise<string | undefined> {
  const sessionClient = (
    client as {
      session?: {
        get?: (args: unknown) => Promise<unknown>;
        messages?: (args: unknown) => Promise<unknown>;
      };
    }
  )?.session;

  if (typeof sessionClient?.get === "function") {
    try {
      const session = unwrapSdkData<{ agent?: string }>(
        await sessionClient.get({ path: { id: sessionID } })
      );
      if (typeof session?.agent === "string" && session.agent.trim()) {
        return session.agent.trim();
      }
    } catch (error) {
      log("resolveSessionAgent: session.get failed", { sessionID, error: String(error) });
    }
  }

  if (typeof sessionClient?.messages !== "function") {
    return undefined;
  }

  try {
    const messages = unwrapSdkData<
      Array<{
        info?: {
          role?: string;
          agent?: string;
          mode?: string;
          summary?: boolean;
        };
      }>
    >(await sessionClient.messages({ path: { id: sessionID } }));

    if (!Array.isArray(messages)) return undefined;

    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i]?.info;
      if (!info) continue;

      if (info.role === "user") {
        if (typeof info.agent === "string" && info.agent.trim()) {
          return info.agent.trim();
        }
        continue;
      }

      if (info.role === "assistant") {
        if (info.summary === true || info.mode === "compaction") continue;
        const agent =
          (typeof info.agent === "string" && info.agent.trim()) ||
          (typeof info.mode === "string" && info.mode.trim()) ||
          undefined;
        if (agent) return agent;
      }
    }
  } catch (error) {
    log("resolveSessionAgent: session.messages failed", { sessionID, error: String(error) });
  }

  return undefined;
}

async function isInternalCaptureSession(client: unknown, sessionID: string): Promise<boolean> {
  // Fast path: sessions we created ourselves (survives brief post-delete window).
  if (isTrackedInternalCaptureSession(sessionID)) {
    return true;
  }

  const sessionClient = (
    client as {
      session?: {
        get?: (args: unknown) => Promise<unknown>;
      };
    }
  )?.session;

  // Plugin host client uses path-based args (same as session.messages).
  if (typeof sessionClient?.get === "function") {
    try {
      const response = await sessionClient.get({ path: { id: sessionID } });
      const title = extractSessionTitle(response);
      if (isInternalCaptureSessionTitle(title)) {
        return true;
      }
      log("internal capture session check via session.get", {
        sessionID,
        title: title ?? null,
        matched: false,
      });
    } catch (error) {
      log("internal capture session check via session.get failed", {
        sessionID,
        error: String(error),
      });
    }
  } else {
    log("internal capture session check: session.get unavailable", { sessionID });
  }

  return false;
}

/** Register `/memory-import-opencode-history`; its work happens in command.execute.before. */
export function applyHistoryImportCommandConfig(cfg: { command?: Record<string, unknown> }): void {
  cfg.command = {
    ...cfg.command,
    [OPENCODE_IMPORT_COMMAND]: {
      template: "Import OpenCode history into omms: $ARGUMENTS",
      description: OPENCODE_IMPORT_DESCRIPTION,
    },
  };
}

/** Least-privilege agent used only by internal structured-output sessions (issue #189). */
export function applyStructuredOutputAgentConfig(cfg: { agent?: Record<string, unknown> }): void {
  cfg.agent = {
    ...cfg.agent,
    [STRUCTURED_OUTPUT_AGENT]: {
      description: "Internal least-privilege agent for omms structured output",
      mode: "subagent",
      // OpenCode reads `steps` at runtime; SDK AgentConfig also documents maxSteps.
      steps: 2,
      maxSteps: 2,
      tools: STRUCTURED_OUTPUT_TOOLS,
      permission: {
        "*": "deny",
        StructuredOutput: "allow",
      },
    },
  };
}

export async function configureOpencodeHostTransport(ctx: {
  readonly client: unknown;
  readonly serverUrl?: string | URL;
}): Promise<void> {
  const { createV2Client, resetHostFetch, setHostFetch, setV2Client } =
    await loadOpencodeProvider();
  resetHostFetch();
  const hostConfig = getHostClientConfig(ctx);
  if (hostConfig.fetch) {
    setHostFetch(hostConfig.fetch);
  } else {
    log("OpenCode host fetch unavailable; falling back to global fetch", {
      clientKeys: hostConfig.clientKeys,
      sdkConfigCount: hostConfig.sdkConfigCount,
    });
  }

  const serverUrl = hostConfig.baseUrl ?? ctx.serverUrl;
  if (serverUrl) {
    setV2Client(
      createV2Client(serverUrl, {
        fetch: hostConfig.fetch,
        headers: hostConfig.headers,
      })
    );
  }
}

function logAutoCaptureProviderStatus(): void {
  if (!CONFIG.autoCaptureEnabled || CONFIG.autoCaptureProviderStatus.ready) return;

  log(
    `Auto-capture disabled by configuration. Issues: ${CONFIG.autoCaptureProviderStatus.issues.join("; ")}.`
  );
}

export const OmmsPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  initConfigWithLegacyMigration(directory);
  // Runs even with tracing off, so turning it off does not leave old traces behind.
  pruneTraces(CONFIG);
  // Record this copy first: the login item and the other hosts run the newest recorded copy.
  void import("./services/runtime-handoff.js")
    .then(({ registerOwnCopy }) => registerOwnCopy())
    .catch((error: unknown) =>
      log("OpenCode runtime record failed", {
        code: error instanceof Error ? error.name : "unknown",
      })
    );
  if (CONFIG.webServerAutoStart !== undefined && process.env.OMMS_DISABLE_WEB_AUTOSTART !== "1") {
    void import("./services/web-autostart.js")
      .then(({ reconcileWebAutostart }) => reconcileWebAutostart(CONFIG))
      .catch((error: unknown) =>
        log("OpenCode login item reconciliation failed", {
          code: error instanceof Error ? error.name : "unknown",
        })
      );
  }
  logAutoCaptureProviderStatus();
  const tags = getTags(directory);
  const autoCaptureHost = createOpenCodeAutoCaptureHost(ctx);
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;

  const GLOBAL_PLUGIN_WARMUP_KEY = Symbol.for("omms.plugin.warmedup");

  if (!(globalThis as any)[GLOBAL_PLUGIN_WARMUP_KEY] && isConfigured()) {
    // Fire-and-forget: DB ready + embedding model must not block plugin init.
    (async () => {
      try {
        await memoryClient.warmup();
        (globalThis as any)[GLOBAL_PLUGIN_WARMUP_KEY] = true;
      } catch (error) {
        log("Plugin memory warmup failed", { error: String(error) });
      }
    })();
  }

  await configureOpencodeHostTransport(ctx);
  // Shared profile dedup, conflict, description, and cleanup calls use OpenCode's host model.
  registerOpencodeProfileModel();
  // In-process backfill, capture, and the capture retry drain use OpenCode's models.
  // Awaited so those paths never run before the registry is filled.
  await import("./adapters/opencode/backfill-startup.js")
    .then(({ registerOpencodeImportModels, registerOpencodeCaptureRetryDrain }) => {
      registerOpencodeImportModels();
      registerOpencodeCaptureRetryDrain(autoCaptureHost, directory);
    })
    .catch(() => {});

  (async () => {
    let connected: string[] = [];
    try {
      const providerResult = await ctx.client.provider.list();
      if (providerResult.data?.connected) {
        connected = providerResult.data.connected;
        const { setConnectedProviders } = await loadOpencodeProvider();
        setConnectedProviders(providerResult.data.connected);
        log("opencode providers connected", {
          list: providerResult.data.connected,
          configured: CONFIG.opencodeProvider || "(not set)",
        });
      } else {
        log("opencode provider list empty or failed", {
          data: JSON.stringify(providerResult.data).substring(0, 100),
        });
      }
    } catch (error) {
      log("Failed to initialize opencode provider state", { error: String(error) });
    }
    const configModel = async () => {
      const response = await ctx.client.config.get();
      return unwrapSdkData<{ model?: string }>(response)?.model ?? null;
    };
    // Run now on a Settings page served by this process can use OpenCode's signed-in models.
    void import("./adapters/opencode/backfill-startup.js")
      .then(({ registerOpencodeBackfillModels }) =>
        registerOpencodeBackfillModels({ connected, directory, configModel })
      )
      .catch(() => {});
    if (CONFIG.autoBackfill && process.env.OMMS_DISABLE_AUTO_BACKFILL !== "1" && isConfigured()) {
      void import("./adapters/opencode/backfill-startup.js")
        .then(({ startOpencodeBackfill }) =>
          startOpencodeBackfill({
            connected,
            directory,
            configModel,
            notify: (message) => {
              void ctx.client.tui
                ?.showToast({
                  body: { title: "Automatic import", message, variant: "info", duration: 5000 },
                })
                .catch(() => {});
            },
          })
        )
        .catch((error: unknown) =>
          log("OpenCode backfill failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }
  })();

  let tursoReadyForWeb = !isConfigured();
  if (CONFIG.webServerEnabled && isConfigured()) {
    try {
      await ensureTursoReady();
      tursoReadyForWeb = true;
    } catch (error) {
      log("Turso ready gate failed before web server start", { error: String(error) });
      if (ctx.client?.tui) {
        ctx.client.tui
          .showToast({
            body: {
              title: "Memory Explorer",
              message: "Database migration failed; web UI not started",
              variant: "error",
              duration: 8000,
            },
          })
          .catch(() => {});
      }
    }
  }

  if (
    CONFIG.webServerEnabled &&
    tursoReadyForWeb &&
    process.env.OMMS_DISABLE_WEB_AUTOSTART !== "1"
  ) {
    const showToast = (message: string, variant: "info" | "error", duration: number) => {
      if (!ctx.client?.tui) return;
      ctx.client.tui
        .showToast({ body: { title: "Memory Explorer", message, variant, duration } })
        .catch(() => {});
    };
    // The shared web app serves the page. This plugin starts it only when none runs.
    void Promise.all([
      import("./services/web-ensure.js"),
      import("./services/web-api-auth.js"),
      import("./services/runtime-handoff.js"),
    ])
      .then(async ([{ ensureWebApp }, { webServerUrl }, { hostReplaceOlder }]) => {
        const baseUrl = webServerUrl(CONFIG.webServerHost, CONFIG.webServerPort);
        // A web app older than the newest recorded copy steps aside for it.
        const replaceOlder = await hostReplaceOlder(CONFIG).catch(() => undefined);
        return ensureWebApp({
          settings: { enabled: CONFIG.webServerEnabled, baseUrl },
          budgetMs: 10_000,
          ...(replaceOlder ? { replaceOlder } : {}),
        }).then((result) => {
          if (result === "running" || result === "started") {
            showToast(`Web UI available at ${baseUrl}`, "info", 3000);
          } else if (result === "port-busy") {
            showToast(
              `Web UI unavailable: another program uses port ${CONFIG.webServerPort}`,
              "error",
              5000
            );
          } else if (result === "no-runtime") {
            showToast(
              "Web UI unavailable: no Node or Bun runtime found to start it",
              "error",
              5000
            );
          }
        });
      })
      .catch((error) => log("Web app start failed", { error: String(error) }));
  }

  let cleanedUp = false;
  const cleanupPlugin = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
    if (memoryClient) await memoryClient.close();
  };

  const shutdownHandler = async () => {
    try {
      await cleanupPlugin();
    } catch (error) {
      log("Shutdown error", { error: String(error) });
      process.exitCode = 1;
    }
  };

  const beforeExitHandler = () => {
    if (!cleanedUp) {
      void cleanupPlugin();
    }
  };
  const exitHandler = () => {
    // Best-effort sync close when the host exits without SIGINT/SIGTERM.
    if (!cleanedUp) {
      try {
        tursoConnectionManager.closeAllSync();
      } catch {
        // ignore Ã¢ÂÂ module may already be torn down
      }
    }
  };

  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);
  process.on("beforeExit", beforeExitHandler);
  process.on("exit", exitHandler);

  const disposePlugin = async () => {
    process.off("SIGINT", shutdownHandler);
    process.off("SIGTERM", shutdownHandler);
    process.off("beforeExit", beforeExitHandler);
    process.off("exit", exitHandler);
    await cleanupPlugin();
  };

  return {
    // V1 ignores this extra hook; the V2 adapter uses it during plugin reload.
    dispose: disposePlugin,
    config: async (cfg) => {
      applyStructuredOutputAgentConfig(cfg);
      applyHistoryImportCommandConfig(cfg);
      applySkillsPathConfig(cfg);
    },

    // V1 runs slash commands as a model turn; do the import here and hand the
    // turn only the finished report to relay.
    "command.execute.before": async (input, output) => {
      if (input.command !== OPENCODE_IMPORT_COMMAND) return;
      const report = await runOpencodeImportCommand({
        argsText: input.arguments ?? "",
        directory,
        sessionModel: () => latestUserMessageModel(ctx.client as any, input.sessionID),
        notify: (message) => {
          void ctx.client?.tui
            ?.showToast({
              body: { title: "omms import", message, variant: "info", duration: 3000 },
            })
            .catch(() => {});
        },
      });
      output.parts.splice(0, output.parts.length, {
        type: "text",
        text: `Reply with this omms history import report exactly as written and nothing else:\n\n\`\`\`\n${report}\n\`\`\``,
      } as any);
    },

    "chat.message": async (input, output) => {
      if (!isConfigured() || !CONFIG.chatMessage.enabled) return;

      try {
        const textParts = output.parts.filter(
          (p): p is Part & { type: "text"; text: string } => p.type === "text"
        );

        if (textParts.length === 0) return;
        const userMessage = textParts.map((p) => p.text).join("\n");
        if (!userMessage.trim()) return;

        if (isInternalPrompt(input.sessionID, userMessage)) return;

        await recordUserPrompt(input.sessionID, output.message.id, directory, userMessage);

        const messagesResponse = await ctx.client.session.messages({
          path: { id: input.sessionID },
        });
        const messages = messagesResponse.data || [];

        const hasNonSyntheticUserMessages = messages.some(
          (m) =>
            m.info.role === "user" &&
            !m.parts.every((p) => p.type !== "text" || p.synthetic === true)
        );

        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const isAfterCompaction = lastMessage?.info?.summary === true;

        const shouldInject =
          CONFIG.chatMessage.injectOn === "always" ||
          !hasNonSyntheticUserMessages ||
          (isAfterCompaction &&
            messages.filter(
              (m) =>
                m.info.role === "user" &&
                !m.parts.every((p) => p.type !== "text" || p.synthetic === true)
            ).length === 1);

        if (!shouldInject) return;

        const memoryContext = await buildRecentMemoriesSection({
          projectTag: tags.project.tag,
          userEmail: tags.user.userEmail,
          sessionId: input.sessionID,
          maxMemories: CONFIG.chatMessage.maxMemories,
          excludeCurrentSession: CONFIG.chatMessage.excludeCurrentSession,
          maxAgeDays: CONFIG.chatMessage.maxAgeDays,
        });

        if (memoryContext) {
          const contextPart: Part = {
            id: `prt-memory-context-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: memoryContext,
            synthetic: true,
          } as any;
          output.parts.unshift(contextPart);
        }
      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
        if (ctx.client?.tui && CONFIG.showErrorToasts) {
          await ctx.client.tui
            .showToast({
              body: {
                title: "Memory System Error",
                message: String(error),
                variant: "error",
                duration: 5000,
              },
            })
            .catch(() => {});
        }
      }
    },

    "chat.params": async (input) => {
      // Record the session model whenever live calls follow it ("inherit" or nothing configured).
      if (!isConfigured() || resolveOpencodeHostModel(CONFIG)?.modelID !== "inherit") return;

      try {
        await userPromptManager.setPromptModel(
          input.message.id,
          input.model.providerID,
          input.model.id
        );
      } catch (error) {
        log("chat.params: ERROR", { error: String(error) });
      }
    },

    tool: {
      memory: tool({
        description: memoryToolDescription(getLanguageName(CONFIG.autoCaptureLanguage || "en")),
        args: {
          mode: tool.schema
            .enum([
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
            ])
            .optional(),
          content: tool.schema.string().optional(),
          query: tool.schema.string().optional(),
          tags: tool.schema.string().optional(),
          type: tool.schema.string().optional(),
          memoryId: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
          scope: tool.schema.enum(["project", "all-projects"]).optional(),
          fromPath: tool.schema.string().optional(),
          fromHash: tool.schema.string().optional(),
          outputPath: tool.schema.string().optional(),
          inputPath: tool.schema.string().optional(),
          dryRun: tool.schema.boolean().optional(),
          allowLinkedSource: tool.schema.boolean().optional(),
        },
        async execute(args: MemoryOperationArgs) {
          const result = await executeMemoryOperation(args, {
            directory,
            tags,
            host: "opencode",
          });
          return JSON.stringify(result);
        },
      }),
    },
    event: async (input: { event: { type: string; properties?: any } }) => {
      const event = input.event;
      if (event.type === "session.created") {
        if (!isConfigured() || !CONFIG.autoCaptureEnabled) return;
        const sessionID = event.properties?.info?.id ?? event.properties?.sessionID;
        // OMMS's own structured-output sessions must not start a retry pass.
        if (sessionID && (await isInternalCaptureSession(ctx.client, sessionID))) return;
        const { startCaptureRetryDrain } = await import("./services/capture-retry-drain.js");
        startCaptureRetryDrain("opencode");
        return;
      }

      if (event.type === "session.idle") {
        if (!isConfigured() || !CONFIG.autoCaptureEnabled) return;
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        // Transient structured-output sessions must not re-trigger capture/learning
        // (that self-schedules an unbounded idle Ã¢ÂÂ LLM Ã¢ÂÂ idle loop).
        if (await isInternalCaptureSession(ctx.client, sessionID)) {
          log("Skipping idle processing for internal capture session", { sessionID });
          return;
        }

        if (idleTimeout) clearTimeout(idleTimeout);

        idleTimeout = setTimeout(async () => {
          try {
            await performAutoCapture(autoCaptureHost, sessionID, directory);

            await performUserProfileLearning(ctx, directory);
            const { cleanupService } = await import("./services/cleanup-service.js");
            if (await cleanupService.shouldRunCleanup()) await cleanupService.runCleanup();
          } catch (error) {
            log("Idle processing error", { error: String(error) });
          } finally {
            idleTimeout = null;
          }
        }, 10000);
      }

      if (event.type === "session.compacted") {
        if (!isConfigured() || !CONFIG.compaction.enabled) return;

        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        try {
          const tags = getTags(directory);

          const memoriesResult = await memoryClient.searchMemoriesBySessionID(
            sessionID,
            tags.project.tag,
            CONFIG.compaction.memoryLimit
          );

          if (!memoriesResult.success || memoriesResult.results.length === 0) {
            return;
          }

          const memoryContext = formatMemoriesForCompaction(memoriesResult.results);
          const agent = await resolveSessionAgent(ctx.client, sessionID);
          if (!agent) {
            log(
              "Compaction: skipped memory injection because session agent could not be resolved",
              {
                sessionID,
              }
            );
            return;
          }

          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              parts: [
                {
                  id: `prt-compaction-${Date.now()}`,
                  type: "text",
                  text: memoryContext,
                  synthetic: true,
                },
              ],
              noReply: true,
              agent,
            },
          });

          if (ctx.client?.tui) {
            await ctx.client.tui
              .showToast({
                body: {
                  title: "Memory Restored",
                  message: `${memoriesResult.results.length} memories injected after compaction`,
                  variant: "success",
                  duration: 3000,
                },
              })
              .catch(() => {});
          }

          log("Compaction memory injected", {
            sessionID,
            count: memoriesResult.results.length,
            agent: agent ?? null,
          });
        } catch (error) {
          log("Compaction handler error", { error: String(error) });
        }
      }
    },
  };
};
