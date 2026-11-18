import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { assertWebServerNetworkAuth } from "./web-api-auth.js";
import type { WebServerConfig } from "./web-server/port-ownership.js";
import type { RouteHost } from "./web-server/route-host.js";
import { routeRequest } from "./web-server/routes.js";
import { serveFetch } from "./web-server/serve-fetch.js";
import { serveStaticFile } from "./web-server/static-files.js";
import { WebControl } from "./web-server/web-control.js";

// Web server startup. The other parts live in ./web-server/: the portable HTTP
// listener (serve-fetch), port ownership, the /api/web/* controls with step-aside
// (web-control), the routes, and the web UI files (static-files).

export { attachNodeDisconnectHandlers } from "./web-server/serve-fetch.js";
export { nextFallbackPort } from "./web-server/port-ownership.js";

/**
 * The importer modules. This is the one services file that may load the
 * importer, so the route modules reach it through the route host.
 */
const importer = {
  api: () => import("../importer/web-import-api.js"),
  jobs: () => import("../importer/web-import-jobs.js"),
  health: () => import("../importer/settings-health.js"),
  models: () => import("../importer/settings-models.js"),
  claudeHook: () => import("../importer/claude-hook-api.js"),
};
export type ImporterModules = typeof importer;

/** The config module, loaded when a route needs it, as each route did before. */
const loadConfig = () => import("../config.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WebServer extends WebControl {
  private stopMaintenance?: () => void;
  private settingsImportJobs?: InstanceType<
    Awaited<ReturnType<ImporterModules["jobs"]>>["SettingsImportJobs"]
  >;
  private backfillControlsInstance?: InstanceType<
    Awaited<ReturnType<ImporterModules["api"]>>["BackfillControls"]
  >;
  private readonly routeHost: RouteHost;

  private async backfillControls() {
    const { BackfillControls } = await importer.api();
    return (this.backfillControlsInstance ??= new BackfillControls());
  }

  private importJobs = async () => {
    const { SettingsImportJobs } = await importer.jobs();
    return (this.settingsImportJobs ??= new SettingsImportJobs());
  };

  constructor(config: WebServerConfig) {
    super(config);
    this.routeHost = {
      config,
      importer,
      loadConfig,
      serveStaticFile: (filename, contentType) => this.serveStaticFile(filename, contentType),
      backfillControls: () => this.backfillControls(),
      importJobs: this.importJobs,
      webControl: async (req, path, method, remoteAddress) =>
        this.webControlRoute(req, path, method, remoteAddress, await loadConfig()),
    };
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this._start();
    return this.startPromise;
  }

  protected async _start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    // Remove OpenCode snapshot copies left by processes that quit mid-import.
    void importer
      .api()
      .then(({ sweepOrphanSnapshots }) => sweepOrphanSnapshots())
      .catch(() => {});
    // Restore records of the automatic cleanup expire after 30 days, even if nothing reads them.
    void import("./user-profile/auto-cleanup-store.js")
      .then(({ pruneAutoCleanupRecords }) => pruneAutoCleanupRecords())
      .catch(() => {});

    const tokens = await import("./api-tokens.js");
    try {
      // `webServerApiToken` is imported into the token table once, then no longer read.
      if (tokens.importConfigApiToken(this.config.apiToken)) {
        log("Imported webServerApiToken into the API token table");
      }
    } catch (error) {
      log(
        "Importing webServerApiToken failed",
        {
          code: error instanceof Error ? error.name : "unknown",
        },
        "error"
      );
    }
    assertWebServerNetworkAuth(
      this.config.host,
      tokens.hasUnexpiredApiToken(),
      this.config.auth?.isEnabled() ?? false
    );

    try {
      this.server = await serveFetch({
        port: this.config.port,
        hostname: this.config.host,
        fetch: this.handleRequest.bind(this),
      });
      this.isOwner = true;
      // A restart copy is named in the start lock until it owns the port.
      void import("./web-ensure.js")
        .then(({ removeStartLockFor }) => removeStartLockFor(process.pid))
        .catch(() => {});
      // This process serves the Claude Code hooks, so it also retries their failed captures.
      void importer
        .claudeHook()
        .then(({ startClaudeCodeWorker }) => startClaudeCodeWorker())
        .catch(() => {});
      void Promise.all([import("./web-jobs.js"), loadConfig()])
        .then(([jobs, config]) => jobs.startWebJobs(() => config.CONFIG))
        .catch(() => {});
      // Daily housekeeping, and deletion only when autoDeleteOldMemories is on (ADR-051).
      void Promise.all([import("./cleanup-service.js"), loadConfig()])
        .then(
          ([m, config]) =>
            (this.stopMaintenance = m.startDailyMaintenanceTimer(() => config.CONFIG))
        )
        .catch(() => {});
    } catch (error) {
      const errorMsg = String(error);

      if (
        errorMsg.includes("EADDRINUSE") ||
        errorMsg.includes("address already in use") ||
        /Failed to start server.*Is port \d+ in use/.test(errorMsg)
      ) {
        this.isOwner = false;
        this.server = null;
        this.startHealthCheckLoop();
      } else {
        this.isOwner = false;
        this.server = null;
        log("Web server failed to start", { error: errorMsg }, "error");
        throw error;
      }
    }
  }

  async stop(): Promise<void> {
    this.stopHealthCheckLoop();
    for (const timer of [this.stepAsideTimer, this.holdOffTimer]) if (timer) clearTimeout(timer);
    this.stepAsideTimer = null;
    this.holdOffTimer = null;
    // A restart whose copy failed calls start() again on this server.
    this.startPromise = null;

    if (!this.isOwner || !this.server) {
      return;
    }

    this.server.stop();
    this.server = null;
    this.isOwner = false;
    this.stopMaintenance?.();
    this.stopMaintenance = undefined;
    const { opencodeSnapshots, stopStandaloneOpencodeReads } = await importer.api();
    await opencodeSnapshots.closeAll();
    await stopStandaloneOpencodeReads();
  }

  // --- HTTP request handling ---

  private async handleRequest(req: Request, remoteAddress?: string): Promise<Response> {
    return routeRequest(this.routeHost, req, remoteAddress);
  }

  private serveStaticFile(filename: string, contentType: string): Response {
    return serveStaticFile(__dirname, filename, contentType);
  }
}

export async function startWebServer(config: WebServerConfig): Promise<WebServer> {
  const server = new WebServer(config);
  await server.start();
  return server;
}
