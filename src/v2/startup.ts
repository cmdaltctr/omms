import type { Context } from "@opencode/plugin/promise/plugin";
import { memoryClient } from "../services/client.js";
import { getTags } from "../services/tags.js";
import { createOpenCodeAutoCaptureHost } from "../adapters/opencode/auto-capture-host.js";
import { pruneTraces } from "../services/capture-diagnostics.js";
import { ensureTursoReady } from "../services/turso/ready.js";
import { tursoConnectionManager } from "../services/turso/connection-manager.js";
import { isConfigured, CONFIG, initConfigWithLegacyMigration } from "../config.js";
import { log } from "../services/logger.js";
import { loadOpencodeProvider } from "../adapters/opencode/opencode-provider-loader.js";
import { registerOpencodeProfileModel } from "../adapters/opencode/profile-model.js";
import { showOpencodeNotice } from "../adapters/opencode/toast.js";

const GLOBAL_PLUGIN_WARMUP_KEY = Symbol.for("omms.plugin.warmedup");

function logAutoCaptureProviderStatus(): void {
  if (!CONFIG.autoCaptureEnabled || CONFIG.autoCaptureProviderStatus.ready) return;

  log(
    `Auto-capture disabled by configuration. Issues: ${CONFIG.autoCaptureProviderStatus.issues.join("; ")}.`
  );
}

/** OpenCode's default model as `provider/model`, read through the V2 model API. */
async function defaultModel(ctx: Pick<Context, "model">): Promise<string | null> {
  const result = await ctx.model.default();
  const model = result?.data;
  return model?.providerID && model?.id ? `${model.providerID}/${model.id}` : null;
}

/** Connected provider ids from the V2 model list. */
async function connectedProviders(ctx: Pick<Context, "model">): Promise<string[]> {
  const models = await ctx.model.list();
  return [...new Set(models.data.map((model) => model.providerID).filter(Boolean))];
}

/** Check providers, then register backfill models and start the automatic backfill. */
async function startProviderWork(ctx: Context, directory: string): Promise<void> {
  let connected: string[] = [];
  try {
    connected = await connectedProviders(ctx);
    if (connected.length > 0) {
      const { setConnectedProviders } = await loadOpencodeProvider();
      setConnectedProviders(connected);
      log("opencode providers connected", {
        list: connected,
        configured: CONFIG.opencodeProvider || "(not set)",
      });
    } else {
      log("opencode provider list empty", undefined, "warn");
    }
  } catch (error) {
    log("Failed to initialize opencode provider state", { error: String(error) }, "error");
  }
  const configModel = () => defaultModel(ctx);
  // Run now on a Settings page served by this process can use OpenCode's signed-in models.
  void import("../adapters/opencode/backfill-startup.js")
    .then(({ registerOpencodeBackfillModels }) =>
      registerOpencodeBackfillModels({ connected, directory, configModel })
    )
    .catch(() => {});
  if (CONFIG.autoBackfill && process.env.OMMS_DISABLE_AUTO_BACKFILL !== "1" && isConfigured()) {
    void import("../adapters/opencode/backfill-startup.js")
      .then(({ startOpencodeBackfill }) =>
        startOpencodeBackfill({
          connected,
          directory,
          configModel,
          notify: (message) =>
            showOpencodeNotice({ title: "Automatic import", message, variant: "info" }),
        })
      )
      .catch((error: unknown) =>
        log(
          "OpenCode backfill failed",
          { error: error instanceof Error ? error.message : String(error) },
          "error"
        )
      );
  }
}

/** Start the shared web app unless one already runs. */
async function startWebApp(): Promise<void> {
  let tursoReadyForWeb = !isConfigured();
  if (CONFIG.webServerEnabled && isConfigured()) {
    try {
      await ensureTursoReady();
      tursoReadyForWeb = true;
    } catch (error) {
      log("Turso ready gate failed before web server start", { error: String(error) }, "error");
      showOpencodeNotice({
        title: "Memory Explorer",
        message: "Database migration failed; web UI not started",
        variant: "error",
      });
    }
  }

  if (
    !CONFIG.webServerEnabled ||
    !tursoReadyForWeb ||
    process.env.OMMS_DISABLE_WEB_AUTOSTART === "1"
  ) {
    return;
  }
  const notice = (message: string, variant: "info" | "error") =>
    showOpencodeNotice({ title: "Memory Explorer", message, variant });
  // The shared web app serves the page. This plugin starts it only when none runs.
  void Promise.all([
    import("../services/web-ensure.js"),
    import("../services/web-api-auth.js"),
    import("../services/runtime-handoff.js"),
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
          notice(`Web UI available at ${baseUrl}`, "info");
        } else if (result === "port-busy") {
          notice(`Web UI unavailable: another program uses port ${CONFIG.webServerPort}`, "error");
        } else if (result === "no-runtime") {
          notice("Web UI unavailable: no Node or Bun runtime found to start it", "error");
        }
      });
    })
    .catch((error) => log("Web app start failed", { error: String(error) }, "error"));
}

/**
 * Start OMMS for an OpenCode V2 plugin: config, traces, runtime record, warm-up, models,
 * backfill, web app and shutdown handlers. Returns the dispose function for plugin unload.
 */
export async function startOpencodeRuntime(ctx: Context, onCleanup: () => void = () => {}) {
  const directory = ctx.location.directory;
  initConfigWithLegacyMigration(directory);

  // Runs even with tracing off, so turning it off does not leave old traces behind.
  pruneTraces(CONFIG);
  // Record this copy first: the login item and the other hosts run the newest recorded copy.
  void import("../services/runtime-handoff.js")
    .then(({ registerOwnCopy }) => registerOwnCopy())
    .catch((error: unknown) =>
      log(
        "OpenCode runtime record failed",
        { code: error instanceof Error ? error.name : "unknown" },
        "error"
      )
    );
  if (CONFIG.webServerAutoStart !== undefined && process.env.OMMS_DISABLE_WEB_AUTOSTART !== "1") {
    void import("../services/web-autostart.js")
      .then(({ reconcileWebAutostart }) => reconcileWebAutostart(CONFIG))
      .catch((error: unknown) =>
        log(
          "OpenCode login item reconciliation failed",
          { code: error instanceof Error ? error.name : "unknown" },
          "error"
        )
      );
  }
  logAutoCaptureProviderStatus();
  const tags = getTags(directory);
  const autoCaptureHost = createOpenCodeAutoCaptureHost(ctx);

  if (!(globalThis as any)[GLOBAL_PLUGIN_WARMUP_KEY] && isConfigured()) {
    // Fire-and-forget: DB ready + embedding model must not block plugin init.
    void (async () => {
      try {
        await memoryClient.warmup();
        (globalThis as any)[GLOBAL_PLUGIN_WARMUP_KEY] = true;
      } catch (error) {
        log("Plugin memory warmup failed", { error: String(error) }, "error");
      }
    })();
  }

  // Shared profile dedup, conflict, description, and cleanup calls use OpenCode's host model.
  registerOpencodeProfileModel();
  // In-process backfill, capture, and the capture retry drain use OpenCode's models.
  // Awaited so those paths never run before the registry is filled.
  await import("../adapters/opencode/backfill-startup.js")
    .then(({ registerOpencodeImportModels, registerOpencodeCaptureRetryDrain }) => {
      registerOpencodeImportModels();
      registerOpencodeCaptureRetryDrain(autoCaptureHost, directory);
    })
    .catch(() => {});

  void startProviderWork(ctx, directory);
  await startWebApp();

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    onCleanup();
    if (memoryClient) await memoryClient.close();
  };
  const shutdownHandler = async () => {
    try {
      await cleanup();
    } catch (error) {
      log("Shutdown error", { error: String(error) }, "error");
      process.exitCode = 1;
    }
  };
  const beforeExitHandler = () => {
    if (!cleanedUp) void cleanup();
  };
  const exitHandler = () => {
    // Best-effort sync close when the host exits without SIGINT/SIGTERM.
    if (cleanedUp) return;
    try {
      tursoConnectionManager.closeAllSync();
    } catch {
      // ignore: the module may already be torn down
    }
  };

  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);
  process.on("beforeExit", beforeExitHandler);
  process.on("exit", exitHandler);

  return {
    directory,
    tags,
    autoCaptureHost,
    async dispose(): Promise<void> {
      process.off("SIGINT", shutdownHandler);
      process.off("SIGTERM", shutdownHandler);
      process.off("beforeExit", beforeExitHandler);
      process.off("exit", exitHandler);
      await cleanup();
    },
  };
}
