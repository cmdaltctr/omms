import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { join, dirname, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { corsPreflightResponse, disallowedCorsResponse, isAllowedBrowserOrigin } from "./cors.js";
import { assertWebServerNetworkAuth, authorizeApiRequest, isLoopbackHost } from "./web-api-auth.js";
import { getOrCreateAuthToken, isAuthorizedApiRequest } from "./auth-token.js";
import { WebAuth } from "./web-auth.js";
import { NODE_HTTP_IDLE_TIMEOUT_MS } from "./request-timeouts.js";
import {
  handleListTags,
  handleListMemories,
  handleAddMemory,
  handleDeleteMemory,
  handleBulkDelete,
  handleUpdateMemory,
  handleSearch,
  handleStats,
  handlePinMemory,
  handleUnpinMemory,
  handleRunCleanup,
  handleRunDeduplication,
  handleDetectMigration,
  handleRunMigration,
  handleDetectTagMigration,
  handleRunTagMigrationBatch,
  handleGetTagMigrationProgress,
  handleDeletePrompt,
  handleBulkDeletePrompts,
  handleGetUserProfile,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleRefreshProfile,
  handleAICleanup,
  handleApplyCleanup,
  handleUpdateProfileItem,
} from "./api-handlers.js";

/**
 * Runtime-portable HTTP server handle.
 *
 * Under Bun we delegate to `Bun.serve` which is the fastest path on that
 * runtime. Under Node we use `node:http` and adapt between IncomingMessage/
 * ServerResponse and the Web `Request`/`Response` primitives used by the
 * fetch-style handler.
 *
 * Both paths expose the same minimal surface — `stop()` and `url` — that the
 * rest of this class relies on, so the WebServer class itself does not need
 * to branch.
 */
interface PortableServerHandle {
  stop(): void;
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

const MIN_FAILED_TAKEOVERS = 3;

type NodeEventSource = {
  on(event: string, listener: (...args: any[]) => void): unknown;
};

export function attachNodeDisconnectHandlers(
  req: NodeEventSource & {
    aborted: boolean;
    complete: boolean;
    socket: NodeEventSource;
  },
  res: NodeEventSource & { writableEnded: boolean },
  onDisconnect: () => void
): void {
  let disconnected = false;
  const disconnectOnce = () => {
    if (disconnected || res.writableEnded) return;
    disconnected = true;
    onDisconnect();
  };

  req.on("aborted", disconnectOnce);
  req.on("close", () => {
    if (req.aborted || !req.complete) disconnectOnce();
  });
  req.socket.on("error", disconnectOnce);
  req.socket.on("close", disconnectOnce);
  res.on("close", disconnectOnce);
}

function serveFetch(opts: {
  port: number;
  hostname: string;
  fetch: (req: Request) => Promise<Response>;
}): PortableServerHandle {
  if (isBun) {
    const bunHandle = (
      globalThis as unknown as { Bun: { serve: (opts: unknown) => { stop: () => void } } }
    ).Bun.serve({
      port: opts.port,
      hostname: opts.hostname,
      fetch: opts.fetch,
    });
    return { stop: () => bunHandle.stop() };
  }

  // Node path: wrap node:http around the fetch-style handler. The adapter
  // converts IncomingMessage → Web Request and Web Response → ServerResponse.
  // Bodies stream both directions via the WHATWG Streams ↔ Node Streams
  // helpers that ship with Node 18+.
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let destroyed = false;
    const abortController = new AbortController();
    const cleanup = () => {
      if (destroyed) return;
      destroyed = true;
      abortController.abort();
      if (!res.writableEnded) res.destroy();
      if (!req.socket.destroyed) req.socket.destroy();
    };
    attachNodeDisconnectHandlers(req, res, cleanup);

    try {
      const url = `http://${opts.hostname}:${opts.port}${req.url ?? "/"}`;
      const method = req.method ?? "GET";
      const hasBody = method !== "GET" && method !== "HEAD";
      const webReq = new Request(url, {
        method,
        headers: req.headers as Record<string, string>,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
        signal: abortController.signal,
        ...(hasBody ? ({ duplex: "half" } as Record<string, unknown>) : {}),
      });

      const webRes = await opts.fetch(webReq);
      if (destroyed) return;
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, name) => res.setHeader(name, value));
      res.setHeader("Connection", "close");

      if (webRes.body) {
        const src = Readable.fromWeb(
          webRes.body as unknown as Parameters<typeof Readable.fromWeb>[0]
        );
        res.on("close", () => {
          if (!src.destroyed) src.destroy();
        });
        src.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
      }
      if (!res.writableEnded) {
        res.end(`Internal Server Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  // Surface EADDRINUSE synchronously so callers can detect the
  // already-running-instance case the same way they do under Bun.
  let listenError: Error | undefined;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      listenError = err;
    }
  });
  // exclusive: false disables SO_EXCLUSIVEADDRUSE on Windows, allowing
  // rebind after a crashed predecessor left orphaned sockets behind.
  server.listen({ port: opts.port, host: opts.hostname, reuseAddr: true, exclusive: false });
  server.unref();
  server.timeout = NODE_HTTP_IDLE_TIMEOUT_MS;
  server.keepAliveTimeout = 10000;
  server.headersTimeout = 11000;

  if (listenError) {
    throw listenError;
  }
  return {
    stop: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Port fallback policy for the takeover loop. A port that fails to bind AND
 * answers no HTTP is treated as orphaned Windows kernel residue; after
 * `minFailedTakeovers` consecutive failed takeovers the web server moves to
 * `currentPort + 1`, bounded by `maxFallbackPort`.
 */
export function nextFallbackPort(
  currentPort: number,
  failedTakeovers: number,
  maxFallbackPort: number,
  minFailedTakeovers: number = MIN_FAILED_TAKEOVERS
): number {
  if (failedTakeovers < minFailedTakeovers || currentPort >= maxFallbackPort) {
    return currentPort;
  }
  return currentPort + 1;
}

interface WebServerConfig {
  port: number;
  host: string;
  directory?: string;
  enabled: boolean;
  auth?: WebAuth;
  apiToken?: string;
}

export class WebServer {
  private server: PortableServerHandle | null = null;
  private config: WebServerConfig;
  private isOwner: boolean = false;
  private startPromise: Promise<void> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private onTakeoverCallback: (() => Promise<void>) | null = null;
  private onPortsExhaustedCallback: (() => void) | null = null;
  private portsExhaustedNotified = false;
  private takeoverFailures: number = 0;
  private readonly maxFallbackPort: number;
  private settingsImportJobs?: import("../importer/web-import-jobs.js").SettingsImportJobs;

  /** Run an import-page action; errors carry their own status and never file contents. */
  private async importResponse(action: () => unknown, status = 200): Promise<Response> {
    try {
      return this.jsonResponse(await action(), status);
    } catch (error) {
      const code = (error as { status?: unknown }).status;
      return this.jsonResponse(
        { error: error instanceof Error ? error.message : "Import request failed" },
        typeof code === "number" ? code : 400
      );
    }
  }

  private async importJobs() {
    const { SettingsImportJobs } = await import("../importer/web-import-jobs.js");
    return (this.settingsImportJobs ??= new SettingsImportJobs());
  }

  constructor(config: WebServerConfig) {
    this.config = config;
    this.maxFallbackPort = config.port + 10;
  }

  setOnTakeoverCallback(callback: () => Promise<void>): void {
    this.onTakeoverCallback = callback;
  }

  setOnPortsExhaustedCallback(callback: () => void): void {
    this.onPortsExhaustedCallback = callback;
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this._start();
    return this.startPromise;
  }

  private async _start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    // Remove OpenCode snapshot copies left by processes that quit mid-import.
    void import("../importer/web-import-api.js")
      .then(({ sweepOrphanSnapshots }) => sweepOrphanSnapshots())
      .catch(() => {});

    assertWebServerNetworkAuth(
      this.config.host,
      this.config.apiToken,
      this.config.auth?.isEnabled() ?? false
    );

    try {
      this.server = serveFetch({
        port: this.config.port,
        hostname: this.config.host,
        fetch: this.handleRequest.bind(this),
      });
      this.isOwner = true;
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
        log("Web server failed to start", { error: errorMsg });
        throw error;
      }
    }
  }

  private startHealthCheckLoop(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      const isAvailable = await this.checkServerAvailable();

      if (!isAvailable) {
        this.stopHealthCheckLoop();
        await this.attemptTakeover();
      }
    }, 5000);
  }

  private stopHealthCheckLoop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async attemptTakeover(): Promise<void> {
    // prevent thundering herd: multiple non-owners racing to bind port
    const jitterMs = 500 + Math.random() * 1000;
    await new Promise((resolve) => setTimeout(resolve, jitterMs));

    if (await this.checkServerAvailable()) {
      // The original owner recovered. Reset the failure counter so a stale
      // count can't advance the port on the next, unrelated failure.
      this.takeoverFailures = 0;
      this.startHealthCheckLoop();
      return;
    }

    // Windows can leave an orphaned LISTEN socket in the TCP table after a
    // crash: the port refuses to bind (EADDRINUSE) yet nothing answers HTTP,
    // so repeated takeovers fail forever. After a few consecutive failures,
    // fall back to a free neighbor port instead of looping.
    this.takeoverFailures += 1;
    const nextPort = nextFallbackPort(
      this.config.port,
      this.takeoverFailures,
      this.maxFallbackPort
    );
    if (nextPort !== this.config.port) {
      this.takeoverFailures = 0;
      log("Web server port held by a non-responsive process; falling back to next port", {
        previousPort: this.config.port,
        newPort: nextPort,
      });
      this.config.port = nextPort;
    } else if (
      this.config.port >= this.maxFallbackPort &&
      this.takeoverFailures >= MIN_FAILED_TAKEOVERS
    ) {
      // Every candidate port is held by a non-responsive process. Stop the
      // health loop instead of retrying every five seconds forever.
      this.stopHealthCheckLoop();
      this.notifyPortsExhausted();
      return;
    }

    try {
      // Reset startPromise so _start() can run again
      this.startPromise = null;
      await this._start();
    } catch {
      this.startHealthCheckLoop();
      return;
    }

    if (this.isOwner) {
      this.takeoverFailures = 0;
      log("Web server takeover successful", { port: this.config.port });

      if (this.onTakeoverCallback) {
        try {
          await this.onTakeoverCallback();
        } catch (error) {
          log("Takeover callback error", { error: String(error) });
        }
      }
    }
  }

  private notifyPortsExhausted(): void {
    if (this.portsExhaustedNotified) return;
    this.portsExhaustedNotified = true;
    log("Web server unavailable: every candidate port is held by a non-responsive process", {
      port: this.config.port,
      maxFallbackPort: this.maxFallbackPort,
    });
    try {
      this.onPortsExhaustedCallback?.();
    } catch (error) {
      log("Ports exhausted callback error", { error: String(error) });
    }
  }

  async stop(): Promise<void> {
    this.stopHealthCheckLoop();

    if (!this.isOwner || !this.server) {
      return;
    }

    this.server.stop();
    this.server = null;
    this.isOwner = false;
    const { opencodeSnapshots } = await import("../importer/web-import-api.js");
    await opencodeSnapshots.closeAll();
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  isServerOwner(): boolean {
    return this.isOwner;
  }

  getUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  async checkServerAvailable(): Promise<boolean> {
    try {
      const headers = this.config.apiToken
        ? { Authorization: `Bearer ${this.config.apiToken}` }
        : undefined;
      const endpoint = this.config.apiToken ? "/api/stats" : "/api/health";
      const response = await fetch(`${this.getUrl()}${endpoint}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return false;
      // Fallback spans 10 neighbor ports; any 2xx from an unrelated local
      // service must not be mistaken for an omms owner. Require the
      // response to carry our API envelope.
      const body = (await response.json()) as { success?: boolean; status?: string };
      if (endpoint === "/api/health") {
        return body.success === true && body.status === "ok";
      }
      return body.success === true;
    } catch {
      return false;
    }
  }

  // --- HTTP request handling ---

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const origin = req.headers.get("Origin");
    const auth = this.config.auth;
    const corsOptions = { httpAuthEnabled: auth?.isEnabled() ?? false };

    if (!isAllowedBrowserOrigin(origin, corsOptions)) {
      return disallowedCorsResponse();
    }

    if (method === "OPTIONS") {
      return corsPreflightResponse(req, corsOptions);
    }

    if (auth?.isEnabled()) {
      const authCheck = auth.check(req, path);
      if (!authCheck.ok && authCheck.response) return authCheck.response;
    }

    if (
      path.startsWith("/api/") &&
      path !== "/api/health" &&
      !(path.startsWith("/api/settings") && auth?.isEnabled()) &&
      !isAuthorizedApiRequest(req)
    ) {
      const configuredTokenFailure = this.config.apiToken
        ? authorizeApiRequest(req, this.config.apiToken)
        : null;
      if (!this.config.apiToken || configuredTokenFailure) {
        return (
          configuredTokenFailure ??
          this.jsonResponse({ success: false, error: "Unauthorized" }, 401)
        );
      }
    }

    if (path.startsWith("/api/settings") && !["GET", "HEAD"].includes(method)) {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
        return this.jsonResponse({ error: "JSON content type required" }, 415);
      }
      if (!isLoopbackHost(this.config.host) && !auth?.isEnabled()) {
        const denied = authorizeApiRequest(req, this.config.apiToken);
        if (!this.config.apiToken || denied) {
          return denied ?? this.jsonResponse({ error: "Unauthorized" }, 401);
        }
      }
    }

    try {
      if (path === "/api/health" && method === "GET") {
        return this.jsonResponse({
          success: true,
          status: "ok",
          authEnabled: auth?.isEnabled() ?? false,
        });
      }

      if (path === "/" || path === "/index.html" || path === "/settings") {
        return this.serveStaticFile("index.html", "text/html");
      }

      if (path === "/favicon.ico") {
        return this.serveStaticFile("favicon.ico", "image/x-icon");
      }

      // Vite production assets (hashed JS/CSS/fonts) and other static files.
      if (method === "GET" && !path.startsWith("/api/")) {
        const relative = path.replace(/^\/+/, "");
        if (relative && !relative.includes("..")) {
          const staticResponse = this.serveStaticFile(relative, this.contentTypeFor(relative));
          if (staticResponse.status !== 404) {
            return staticResponse;
          }
        }
      }

      if (path === "/api/settings" && method === "GET") {
        const { getSettingsSnapshot } = await import("./settings-snapshot.js");
        return this.jsonResponse(getSettingsSnapshot(this.config.directory ?? process.cwd()));
      }

      if (path === "/api/settings" && method === "PATCH") {
        const body = (await req.json()) as { edits?: Record<string, unknown>; revision?: string };
        if (
          !body ||
          typeof body.edits !== "object" ||
          !body.edits ||
          Array.isArray(body.edits) ||
          typeof body.revision !== "string"
        ) {
          return this.jsonResponse({ error: "Edits and revision required" }, 400);
        }
        if (
          body.edits.captureTrace === true &&
          !isLoopbackHost(this.config.host) &&
          !auth?.isEnabled()
        ) {
          return this.jsonResponse({ error: "Tracing requires Basic Auth on network hosts" }, 403);
        }
        const { writeGlobalConfigKeys, ConfigConflictError } =
          await import("./global-config-writer.js");
        let result;
        try {
          result = await writeGlobalConfigKeys(body.edits, body.revision);
        } catch (error) {
          return this.jsonResponse(
            { error: error instanceof Error ? error.message : "Invalid settings" },
            error instanceof ConfigConflictError ? 409 : 400
          );
        }
        // The file is already saved; a reload problem must not report the save as failed.
        try {
          const { refreshConfigIfChanged } = await import("../config.js");
          refreshConfigIfChanged(this.config.directory ?? process.cwd());
        } catch (error) {
          log("Settings saved, but reloading them failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return this.jsonResponse(result);
      }

      if (path === "/api/settings/models" && method === "GET") {
        const { listOpencodeSettingsModels, listPiSettingsModels } =
          await import("./settings-models.js");
        const host = url.searchParams.get("host");
        if (host === "pi") return this.jsonResponse(await listPiSettingsModels());
        if (host === "opencode") return this.jsonResponse(await listOpencodeSettingsModels());
        return this.jsonResponse({ error: "Invalid host" }, 400);
      }

      if (path === "/api/settings/diagnostics" && method === "GET") {
        const { queryCaptureAttempts } = await import("./capture-attempt-store.js");
        const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || 7));
        return this.jsonResponse(
          await queryCaptureAttempts(Date.now() - days * 86400000, Date.now())
        );
      }

      if (path === "/api/settings/traces" && method === "GET") {
        const { listSettingsTraces } = await import("./settings-traces.js");
        return this.jsonResponse({ traces: await listSettingsTraces() });
      }

      if (path.startsWith("/api/settings/traces/") && (method === "GET" || method === "DELETE")) {
        const file = decodeURIComponent(path.slice("/api/settings/traces/".length));
        if (!/^capture-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)) {
          return this.jsonResponse({ error: "Invalid trace file name" }, 400);
        }
        const { readSettingsTrace, deleteSettingsTrace } = await import("./settings-traces.js");
        if (method === "DELETE") {
          await deleteSettingsTrace(file);
          return this.jsonResponse({ deleted: true });
        }
        return this.jsonResponse({ file, content: await readSettingsTrace(file) });
      }

      if (path === "/api/settings/health" && method === "POST") {
        const body = (await req.json()) as { testModels?: unknown };
        if (
          !body ||
          typeof body !== "object" ||
          (body.testModels !== undefined && typeof body.testModels !== "boolean")
        ) {
          return this.jsonResponse({ error: "Invalid health options" }, 400);
        }
        const { runSettingsHealth } = await import("../importer/settings-health.js");
        return this.jsonResponse(
          await runSettingsHealth({
            directory: this.config.directory ?? process.cwd(),
            host: this.config.host,
            authEnabled: auth?.isEnabled() ?? false,
            apiTokenSet: Boolean(this.config.apiToken),
            testModels: body.testModels === true,
          })
        );
      }

      if (path === "/api/settings/imports/readiness" && method === "GET") {
        const { importReadiness } = await import("../importer/web-import-api.js");
        return this.jsonResponse(await importReadiness());
      }

      if (path === "/api/settings/imports/sources/browse" && method === "POST") {
        // Listing folders would expose the machine's layout to remote users.
        if (!isLoopbackHost(this.config.host)) {
          return this.jsonResponse(
            { error: "Browsing is available only on a loopback bind; enter a path instead" },
            403
          );
        }
        const body = (await req.json()) as { host?: unknown; path?: unknown };
        if (body?.host !== "pi" && body?.host !== "opencode") {
          return this.jsonResponse({ error: "Choose Pi or OpenCode" }, 400);
        }
        const { browseImportSources } = await import("../importer/web-import-api.js");
        return this.importResponse(() => browseImportSources(body.host as "pi", body.path));
      }

      if (path === "/api/settings/imports/sources/validate" && method === "POST") {
        const body = (await req.json()) as { host?: unknown; path?: unknown };
        if (body?.host !== "pi" && body?.host !== "opencode") {
          return this.jsonResponse({ error: "Choose Pi or OpenCode" }, 400);
        }
        const { validateImportSource } = await import("../importer/web-import-api.js");
        return this.importResponse(() => validateImportSource(body.host as "pi", body.path));
      }

      if (path === "/api/settings/imports/sessions" && method === "POST") {
        const body = (await req.json()) as Record<string, unknown> | null;
        const { listImportSessions, validateSessionListRequest } =
          await import("../importer/web-import-api.js");
        return this.importResponse(async () => {
          const request = validateSessionListRequest(body);
          return listImportSessions(request, {
            ...request.match,
            cwd: this.config.directory ?? process.cwd(),
          });
        });
      }

      if (path === "/api/settings/imports" && method === "POST") {
        const jobs = await this.importJobs();
        return this.importResponse(
          async () => jobs.start(await req.json(), this.config.directory ?? process.cwd()),
          202
        );
      }

      if (path === "/api/settings/imports/current" && method === "GET") {
        return this.jsonResponse({ job: (await this.importJobs()).current() });
      }

      if (path === "/api/settings/imports/current/cancel" && method === "POST") {
        try {
          return this.jsonResponse({ job: (await this.importJobs()).cancel() });
        } catch (error) {
          return this.jsonResponse(
            { error: error instanceof Error ? error.message : "No running import" },
            409
          );
        }
      }

      if (path === "/api/settings/log" && method === "GET") {
        const { readSettingsLog } = await import("./settings-log.js");
        return this.jsonResponse(
          await readSettingsLog(
            Number(url.searchParams.get("lines") ?? 200),
            url.searchParams.get("filter") === "capture"
          )
        );
      }

      if (path === "/api/tags" && method === "GET") {
        const result = await handleListTags();
        return this.jsonResponse(result);
      }

      if (path === "/api/memories" && method === "GET") {
        const tag = url.searchParams.get("tag") || undefined;
        const page = parseInt(url.searchParams.get("page") || "1");
        const pageSize = parseInt(url.searchParams.get("pageSize") || "20");
        const includePrompts = url.searchParams.get("includePrompts") !== "false";
        const result = await handleListMemories(tag, page, pageSize, includePrompts);
        return this.jsonResponse(result);
      }

      if (path === "/api/memories" && method === "POST") {
        const body = (await req.json()) as any;
        const result = await handleAddMemory(body);
        return this.jsonResponse(result);
      }

      if (path.startsWith("/api/memories/") && method === "DELETE") {
        const parts = path.split("/");
        const id = parts[3];
        if (!id || id === "bulk-delete") {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const cascade = url.searchParams.get("cascade") === "true";
        const result = await handleDeleteMemory(id, cascade);
        return this.jsonResponse(result);
      }

      if (path.startsWith("/api/memories/") && method === "PUT") {
        const id = path.split("/").pop();
        if (!id) {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const body = (await req.json()) as any;
        const result = await handleUpdateMemory(id, body);
        return this.jsonResponse(result);
      }

      if (path === "/api/memories/bulk-delete" && method === "POST") {
        const body = (await req.json()) as any;
        const cascade = body.cascade !== false;
        const result = await handleBulkDelete(body.ids || [], cascade);
        return this.jsonResponse(result);
      }

      if (path === "/api/search" && method === "GET") {
        const query = url.searchParams.get("q");
        const tag = url.searchParams.get("tag") || undefined;
        const page = parseInt(url.searchParams.get("page") || "1");
        const pageSize = parseInt(url.searchParams.get("pageSize") || "20");

        if (!query) {
          return this.jsonResponse({ success: false, error: "query parameter required" });
        }

        const result = await handleSearch(query, tag, page, pageSize);
        return this.jsonResponse(result);
      }

      if (path === "/api/stats" && method === "GET") {
        const result = await handleStats();
        return this.jsonResponse(result);
      }

      if (path.match(/^\/api\/memories\/[^/]+\/pin$/) && method === "POST") {
        const id = path.split("/")[3];
        if (!id) {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const result = await handlePinMemory(id);
        return this.jsonResponse(result);
      }

      if (path.match(/^\/api\/memories\/[^/]+\/unpin$/) && method === "POST") {
        const id = path.split("/")[3];
        if (!id) {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const result = await handleUnpinMemory(id);
        return this.jsonResponse(result);
      }

      if (path === "/api/cleanup" && method === "POST") {
        const result = await handleRunCleanup();
        return this.jsonResponse(result);
      }

      if (path === "/api/deduplicate" && method === "POST") {
        const result = await handleRunDeduplication();
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/detect" && method === "GET") {
        const result = await handleDetectMigration();
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/tags/detect" && method === "GET") {
        const result = await handleDetectTagMigration();
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/tags/run-batch" && method === "POST") {
        const body = (await req.json()) as any;
        const batchSize = body?.batchSize || 5;
        const result = await handleRunTagMigrationBatch(batchSize);
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/tags/progress" && method === "GET") {
        const result = await handleGetTagMigrationProgress();
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/run" && method === "POST") {
        const body = (await req.json()) as any;
        const strategy = body.strategy || "fresh-start";
        if (strategy !== "fresh-start" && strategy !== "re-embed") {
          return this.jsonResponse({ success: false, error: "Invalid strategy" });
        }
        const result = await handleRunMigration(strategy);
        return this.jsonResponse(result);
      }

      if (path.startsWith("/api/prompts/") && method === "DELETE") {
        const parts = path.split("/");
        const id = parts[3];
        if (!id || id === "bulk-delete") {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const cascade = url.searchParams.get("cascade") === "true";
        const result = await handleDeletePrompt(id, cascade);
        return this.jsonResponse(result);
      }

      if (path === "/api/prompts/bulk-delete" && method === "POST") {
        const body = (await req.json()) as any;
        const cascade = body.cascade !== false;
        const result = await handleBulkDeletePrompts(body.ids || [], cascade);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile" && method === "GET") {
        const userId = url.searchParams.get("userId") || undefined;
        const result = await handleGetUserProfile(userId);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/changelog" && method === "GET") {
        const profileId = url.searchParams.get("profileId");
        const limit = parseInt(url.searchParams.get("limit") || "5");
        if (!profileId) {
          return this.jsonResponse({ success: false, error: "profileId parameter required" });
        }
        const result = await handleGetProfileChangelog(profileId, limit);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/snapshot" && method === "GET") {
        const changelogId = url.searchParams.get("chlogId");
        if (!changelogId) {
          return this.jsonResponse({ success: false, error: "changelogId parameter required" });
        }
        const result = await handleGetProfileSnapshot(changelogId);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/refresh" && method === "POST") {
        const body = (await req.json().catch(() => ({}))) as any;
        const userId = body.userId || undefined;
        const result = await handleRefreshProfile(userId);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/ai-cleanup" && method === "POST") {
        const body = (await req.json().catch(() => ({}))) as any;
        const userId = body.userId || undefined;
        const includeIds = Array.isArray(body.includeIds)
          ? (body.includeIds as string[])
          : undefined;
        const profileVersion =
          typeof body.profileVersion === "number" ? body.profileVersion : undefined;
        const result = await handleAICleanup(userId, includeIds, profileVersion);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/ai-cleanup/apply" && method === "POST") {
        const body = (await req.json().catch(() => ({}))) as any;
        const userId = body.userId || undefined;
        const result = await handleApplyCleanup(userId, body);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/item" && method === "PATCH") {
        const body = (await req.json().catch(() => ({}))) as any;
        const result = await handleUpdateProfileItem(body);
        return this.jsonResponse(result);
      }

      // SPA fallback for client routes (e.g. /profile) — serve the app shell.
      if (method === "GET" && !path.startsWith("/api/") && !extname(path)) {
        return this.serveStaticFile("index.html", "text/html");
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return this.jsonResponse(
        {
          success: false,
          error: String(error),
        },
        500
      );
    }
  }

  private contentTypeFor(filename: string): string {
    switch (extname(filename).toLowerCase()) {
      case ".html":
        return "text/html";
      case ".js":
      case ".mjs":
        return "application/javascript";
      case ".css":
        return "text/css";
      case ".ico":
        return "image/x-icon";
      case ".svg":
        return "image/svg+xml";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".woff":
        return "font/woff";
      case ".woff2":
        return "font/woff2";
      case ".ttf":
        return "font/ttf";
      case ".json":
        return "application/json";
      case ".map":
        return "application/json";
      default:
        return "application/octet-stream";
    }
  }

  private serveStaticFile(filename: string, contentType: string): Response {
    try {
      const webDir = [
        join(__dirname, "..", "web"),
        join(__dirname, "..", "..", "dist", "web"),
      ].find((candidate) => existsSync(candidate));
      if (!webDir) {
        return new Response("File not found", { status: 404 });
      }

      const filePath = normalize(join(webDir, filename));
      const normalizedWebDir = normalize(webDir);
      if (filePath !== normalizedWebDir && !filePath.startsWith(`${normalizedWebDir}${sep}`)) {
        return new Response("File not found", { status: 404 });
      }
      if (!existsSync(filePath)) {
        return new Response("File not found", { status: 404 });
      }

      const cacheControl =
        filename.startsWith("assets/") || contentType.startsWith("font/")
          ? "public, max-age=31536000, immutable"
          : contentType.startsWith("image/")
            ? "public, max-age=86400"
            : "no-cache";

      if (
        contentType.startsWith("image/") ||
        contentType.startsWith("font/") ||
        contentType === "application/octet-stream"
      ) {
        const content = readFileSync(filePath);
        return new Response(content, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": cacheControl,
          },
        });
      }

      let content = readFileSync(filePath, "utf-8");

      if (filename === "index.html" || filename.endsWith("/index.html")) {
        const token = getOrCreateAuthToken();
        content = content.replace(
          "</head>",
          `<script>window.__OMMS_TOKEN__=${JSON.stringify(token)};</script></head>`
        );
      }

      return new Response(content, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": cacheControl,
        },
      });
    } catch {
      return new Response("File not found", { status: 404 });
    }
  }

  private jsonResponse(data: any, status: number = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

export async function startWebServer(config: WebServerConfig): Promise<WebServer> {
  const server = new WebServer(config);
  await server.start();
  return server;
}
