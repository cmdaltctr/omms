import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { join, dirname, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { corsPreflightResponse, disallowedCorsResponse, isAllowedBrowserOrigin } from "./cors.js";
import {
  assertWebServerNetworkAuth,
  authorizeApiRequest,
  isLoopbackAddress,
  isLoopbackHost,
  webServerUrl,
} from "./web-api-auth.js";
import { packageVersion } from "./package-version.js";
import type { UpdateStatus, WebUpdate } from "./web-update.js";
import { isOlderVersion } from "./version-compare.js";
import { AUTH_HEADER, getOrCreateAuthToken, isAuthorizedApiRequest } from "./auth-token.js";
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
  fetch: (req: Request, remoteAddress?: string) => Promise<Response>;
}): Promise<PortableServerHandle> {
  if (isBun) {
    type BunServer = { requestIP(req: Request): { address: string } | null };
    const bunHandle = (
      globalThis as unknown as { Bun: { serve: (opts: unknown) => { stop: () => void } } }
    ).Bun.serve({
      port: opts.port,
      hostname: opts.hostname,
      fetch: (req: Request, server: BunServer) => opts.fetch(req, server.requestIP(req)?.address),
    });
    return Promise.resolve({ stop: () => bunHandle.stop() });
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

      const webRes = await opts.fetch(webReq, req.socket.remoteAddress);
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

  server.unref();
  server.timeout = NODE_HTTP_IDLE_TIMEOUT_MS;
  server.keepAliveTimeout = 10000;
  server.headersTimeout = 11000;

  // Node reports EADDRINUSE after listen() returns, so wait for the outcome.
  // Callers then see a busy port the same way they do under Bun.
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      // Keep a listener, so a later server error is logged instead of crashing the process.
      server.on("error", (error) => log("Web server error", { error: String(error) }));
      resolve({
        stop: () => {
          server.closeAllConnections();
          server.close();
        },
      });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    // exclusive: false disables SO_EXCLUSIVEADDRUSE on Windows, allowing
    // rebind after a crashed predecessor left orphaned sockets behind.
    server.listen({ port: opts.port, host: opts.hostname, reuseAddr: true, exclusive: false });
  });
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
  /** How long a stepped-aside server waits before it may take the port back. */
  stepAsideHoldOffMs?: number;
}

type PowerAction = "stop" | "restart";

const STEP_ASIDE_HOLD_OFF_MS = 60_000;
/** What a web app without an npm check reports, such as one inside a host session. */
const NO_UPDATE: UpdateStatus = { available: null, state: "idle", code: null, canInstall: false };
/** Lets the 202 reply reach the caller before the server stops. */
const STEP_ASIDE_REPLY_GRACE_MS = 100;
/**
 * Differs between processes, so the page can tell a restarted web app from the old one.
 * A restart names its copy's instance, so it can tell its copy from another web app.
 */
const PROCESS_INSTANCE = /^[0-9a-f-]{36}$/.test(process.env.OMMS_WEB_INSTANCE ?? "")
  ? process.env.OMMS_WEB_INSTANCE!
  : randomUUID();
// Child processes, such as an OpenCode model list, must not report the same instance.
delete process.env.OMMS_WEB_INSTANCE;

export class WebServer {
  private server: PortableServerHandle | null = null;
  private config: WebServerConfig;
  private isOwner: boolean = false;
  private startPromise: Promise<void> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private onTakeoverCallback: (() => Promise<void>) | null = null;
  private onPortsExhaustedCallback: (() => void) | null = null;
  private onStepAsideCallback: (() => void | Promise<void>) | null = null;
  private onPowerActionCallback: ((action: PowerAction) => unknown) | null = null;
  private webUpdate: Pick<WebUpdate, "status" | "requestInstall"> | null = null;
  private powerActionRunning = false;
  private stepAsideTimer: NodeJS.Timeout | null = null;
  private holdOffTimer: NodeJS.Timeout | null = null;
  private portsExhaustedNotified = false;
  private takeoverFailures: number = 0;
  private readonly maxFallbackPort: number;
  private settingsImportJobs?: import("../importer/web-import-jobs.js").SettingsImportJobs;
  private backfillControlsInstance?: import("../importer/web-import-api.js").BackfillControls;
  /** The memory store's projects for Directory maps suggestions, read at most once a minute. */
  private storeProjects?: {
    readAt: number;
    projects: Promise<import("../importer/web-import-api.js").KnownProject[]>;
  };

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

  /** Claude Code hook requests; they reach this point only with a valid API token. */
  private async claudeHookResponse(req: Request, path: string): Promise<Response> {
    const api = await import("../importer/claude-hook-api.js");
    const body: unknown = await req.json().catch(() => null);
    try {
      if (path === "/api/claude/capture") {
        return this.jsonResponse(api.handleClaudeCapture(body), 202);
      }
      const cwd = this.config.directory ?? process.cwd();
      return this.jsonResponse(
        await api.handleClaudeRetrieve(body, {
          startBackfill: async () => (await this.backfillControls()).startAuto("claude-code", cwd),
        })
      );
    } catch (error) {
      if (error instanceof api.ClaudeHookRequestError) {
        return this.jsonResponse({ error: error.message }, error.status);
      }
      throw error;
    }
  }

  private async backfillControls() {
    const { BackfillControls } = await import("../importer/web-import-api.js");
    return (this.backfillControlsInstance ??= new BackfillControls());
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

  /** Standalone web apps register this to exit when a newer OMMS asks them to step aside. */
  setOnStepAside(callback: () => void | Promise<void>): void {
    this.onStepAsideCallback = callback;
  }

  /** Standalone web apps register this to stop or restart from the page. */
  setOnPowerAction(callback: (action: PowerAction) => unknown): void {
    this.onPowerActionCallback = callback;
  }

  /** Standalone web apps register this to report and install npm releases. */
  setWebUpdate(update: Pick<WebUpdate, "status" | "requestInstall">): void {
    this.webUpdate = update;
  }

  /** Only a local caller may stop the web app; the token alone is not enough. */
  private handlePowerAction(action: PowerAction, remoteAddress: string | undefined): Response {
    const record = (outcome: string) =>
      log("Web server power request", { action, outcome, ownVersion: packageVersion() });
    if (!isLoopbackAddress(remoteAddress)) {
      record("refused_not_loopback");
      return this.jsonResponse({ success: false, error: "Loopback caller required" }, 403);
    }
    const callback = this.onPowerActionCallback;
    if (!callback) {
      record("unsupported");
      return this.jsonResponse({ success: false, error: "Not supported by this web app" }, 409);
    }
    // A repeated request must not start a second stop or restart while one runs.
    if (this.powerActionRunning) {
      record("already_running");
      return this.jsonResponse({ success: true }, 202);
    }
    this.powerActionRunning = true;
    record(action === "stop" ? "stopping" : "restarting");
    // Let the 202 reply reach the caller before the web app goes down.
    setTimeout(async () => {
      try {
        await callback(action);
      } catch (error) {
        log("Power action callback error", { action, error: String(error) });
      } finally {
        this.powerActionRunning = false;
      }
    }, STEP_ASIDE_REPLY_GRACE_MS).unref();
    return this.jsonResponse({ success: true }, 202);
  }

  /** Install the npm release and restart onto it. Same guards as Restart. */
  private handleUpdate(remoteAddress: string | undefined): Response {
    const record = (outcome: string) =>
      log("Web server update request", { outcome, ownVersion: packageVersion() });
    if (!isLoopbackAddress(remoteAddress)) {
      record("refused_not_loopback");
      return this.jsonResponse({ success: false, error: "Loopback caller required" }, 403);
    }
    const reply = this.webUpdate?.requestInstall() ?? "cannot-install";
    record(reply);
    if (reply === "accepted") return this.jsonResponse({ success: true }, 202);
    const error = reply === "no-update" ? "No newer release" : "This web app cannot install";
    return this.jsonResponse({ success: false, error }, 409);
  }

  /** API token routes. Only a caller on this machine with the local token manages tokens. */
  private async handleTokenRoute(
    req: Request,
    path: string,
    method: string,
    remoteAddress: string | undefined
  ): Promise<Response> {
    if (!isLoopbackAddress(remoteAddress)) {
      return this.jsonResponse({ error: "Only this machine can manage API tokens" }, 403);
    }
    if (!isAuthorizedApiRequest(req)) {
      return this.jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }
    const tokens = await import("./api-tokens.js");
    if (path === "/api/settings/tokens" && method === "GET") {
      return this.jsonResponse({ tokens: tokens.listApiTokens() });
    }
    if (path === "/api/settings/tokens" && method === "POST") {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      try {
        const expiry = body?.expiresInDays ?? null;
        return this.jsonResponse(
          tokens.createApiToken(
            String(body?.name ?? ""),
            expiry as import("./api-tokens.js").TokenExpiryDays
          ),
          201
        );
      } catch (error) {
        return this.jsonResponse(
          { error: error instanceof Error ? error.message : "Token not created" },
          400
        );
      }
    }
    const revoke = /^\/api\/settings\/tokens\/([A-Za-z0-9-]{1,64})$/.exec(path);
    if (revoke && method === "DELETE") {
      return tokens.revokeApiToken(revoke[1]!)
        ? this.jsonResponse({ success: true })
        : this.jsonResponse({ error: "Token not found" }, 404);
    }
    return this.jsonResponse({ error: "Not found" }, 404);
  }

  /** Profile catch-up: a preview for anyone with API access; runs only from this machine. */
  private async handleCatchUpRoute(
    req: Request,
    path: string,
    method: string,
    remoteAddress: string | undefined
  ): Promise<Response | null> {
    const catchUp = await import("../importer/web-import-api.js");
    if (path === "/api/settings/profile/catch-up" && method === "GET") {
      return this.jsonResponse({
        preview: await catchUp.previewCatchUp(),
        job: catchUp.catchUpState(),
      });
    }
    const action = /^\/api\/settings\/profile\/catch-up\/(start|pause|resume)$/.exec(path)?.[1];
    if (!action || method !== "POST") return null;
    if (!isLoopbackAddress(remoteAddress) || !isAuthorizedApiRequest(req)) {
      return this.jsonResponse({ error: "Only this machine can run a profile catch-up" }, 403);
    }
    if (action === "pause") return this.jsonResponse(catchUp.pauseCatchUp());
    try {
      const job = await catchUp.startCatchUp(this.config.directory ?? process.cwd());
      return this.jsonResponse(job, 202);
    } catch (error) {
      return this.jsonResponse(
        { error: error instanceof Error ? error.message : "Catch-up not started" },
        (error as { status?: number }).status ?? 400
      );
    }
  }

  /** List active profiles, choose the one in use, or merge one into another. */
  private async handleProfilesRoute(
    req: Request,
    path: string,
    method: string
  ): Promise<Response | null> {
    const { userProfileManager } = await import("./user-profile/user-profile-manager.js");
    const { listProfiles, mergeProfiles, ProfileAdminError } = await import("./profile-admin.js");
    const { resolveWebProfileUserId } = await import("./profile-identity.js");
    const { CONFIG } = await import("../config.js");
    const store = userProfileManager;
    if (path === "/api/settings/profiles" && method === "GET") {
      const current = await resolveWebProfileUserId(CONFIG);
      return this.jsonResponse({ profiles: await listProfiles(store, current) });
    }
    if (method !== "POST") return null;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    try {
      if (path === "/api/settings/profiles/use") {
        const userId = typeof body?.userId === "string" ? body.userId : "";
        if (typeof body?.revision !== "string") {
          return this.jsonResponse({ error: "Revision required" }, 400);
        }
        const active = await store.getAllActiveProfiles();
        if (!active.some((profile) => profile.userId === userId)) {
          return this.jsonResponse({ error: "No active profile has that email" }, 404);
        }
        const { writeGlobalConfigKeys } = await import("./global-config-writer.js");
        const result = await writeGlobalConfigKeys({ userEmailOverride: userId }, body.revision, {
          only: new Set(["userEmailOverride"]),
        });
        const { refreshConfigIfChanged } = await import("../config.js");
        refreshConfigIfChanged(this.config.directory ?? process.cwd());
        return this.jsonResponse(result);
      }
      if (path === "/api/settings/profiles/merge") {
        const sourceId = typeof body?.sourceId === "string" ? body.sourceId : "";
        const targetId = typeof body?.targetId === "string" ? body.targetId : "";
        return this.jsonResponse(await mergeProfiles(store, sourceId, targetId));
      }
    } catch (error) {
      const status =
        error instanceof ProfileAdminError
          ? error.status
          : ((error as { status?: number }).status ?? 400);
      return this.jsonResponse(
        { error: error instanceof Error ? error.message : "Profile change failed" },
        status
      );
    }
    return null;
  }

  /** Set or clear the browser password. The body holds the password: never log or echo it. */
  private async handleWebPassword(
    req: Request,
    remoteAddress: string | undefined
  ): Promise<Response> {
    if (!isLoopbackAddress(remoteAddress) || !isAuthorizedApiRequest(req)) {
      return this.jsonResponse({ error: "Only this machine can change the browser password" }, 403);
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (typeof body?.revision !== "string") {
      return this.jsonResponse({ error: "Revision required" }, 400);
    }
    try {
      const { clearWebPassword, saveWebPassword } = await import("./web-password.js");
      const result =
        body.clear === true
          ? await clearWebPassword(body.revision)
          : await saveWebPassword(
              password,
              typeof body.username === "string" ? body.username : undefined,
              body.revision
            );
      const { refreshConfigIfChanged } = await import("../config.js");
      refreshConfigIfChanged(this.config.directory ?? process.cwd());
      return this.jsonResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Password not saved";
      return this.jsonResponse(
        { error: password ? message.replaceAll(password, "[redacted]") : message },
        (error as { status?: number }).status ?? 400
      );
    }
  }

  /** Embedding card routes. Changing the embedder needs a caller on this machine with the local token. */
  private async handleEmbeddingRoute(
    req: Request,
    path: string,
    method: string,
    remoteAddress: string | undefined
  ): Promise<Response | null> {
    const change = await import("./embedding-change.js");
    if (path === "/api/settings/embedding" && method === "GET") {
      return this.jsonResponse(await change.currentEmbedding());
    }
    if (path === "/api/settings/embedding/run" && method === "GET") {
      return this.jsonResponse(change.embeddingRunState());
    }
    const routes = ["/api/settings/embedding/test", "/api/settings/embedding/apply"];
    if (method !== "POST" || ![...routes, "/api/settings/embedding/run"].includes(path))
      return null;
    if (!isLoopbackAddress(remoteAddress) || !isAuthorizedApiRequest(req)) {
      return this.jsonResponse({ error: "Only this machine can change the embedder" }, 403);
    }
    // The body can hold a pasted key: never log it, and never echo it back.
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const pasted = (body?.candidate ?? body) as { key?: { value?: unknown } } | null;
    const secret = typeof pasted?.key?.value === "string" ? pasted.key.value.trim() : "";
    try {
      if (path === "/api/settings/embedding/test") {
        return this.jsonResponse(
          await change.testEmbeddingCandidate(change.parseEmbeddingCandidate(body))
        );
      }
      if (path === "/api/settings/embedding/run") {
        await change.startReembed();
        return this.jsonResponse(change.embeddingRunState(), 202);
      }
      if (typeof body?.revision !== "string") {
        return this.jsonResponse({ error: "Revision required" }, 400);
      }
      const { refreshConfigIfChanged } = await import("../config.js");
      await change.applyEmbeddingCandidate(
        change.parseEmbeddingCandidate(body.candidate),
        body.revision,
        () => {
          refreshConfigIfChanged(this.config.directory ?? process.cwd());
        }
      );
      return this.jsonResponse(change.embeddingRunState(), 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Embedder not changed";
      const status = (error as { status?: number }).status ?? 400;
      return this.jsonResponse(
        { error: secret ? message.replaceAll(secret, "[redacted]") : message },
        status
      );
    }
  }

  private scheduleStepAside(): void {
    if (this.stepAsideTimer) return;
    this.stepAsideTimer = setTimeout(async () => {
      this.stepAsideTimer = null;
      if (this.onStepAsideCallback) {
        try {
          await this.onStepAsideCallback();
        } catch (error) {
          log("Step-aside callback error", { error: String(error) });
        }
        return;
      }
      // Inside a host session: stop serving, keep the session alive, and let the
      // newer web app bind the port before the takeover loop can run again.
      await this.stop();
      this.startPromise = null;
      this.holdOffTimer = setTimeout(() => {
        this.holdOffTimer = null;
        this.startHealthCheckLoop();
      }, this.config.stepAsideHoldOffMs ?? STEP_ASIDE_HOLD_OFF_MS);
      this.holdOffTimer.unref();
    }, STEP_ASIDE_REPLY_GRACE_MS);
    this.stepAsideTimer.unref();
  }

  private handleStepAside(remoteAddress: string | undefined, body: unknown): Response {
    const callerVersion =
      body && typeof (body as { version?: unknown }).version === "string"
        ? (body as { version: string }).version.slice(0, 40)
        : "";
    const record = (outcome: string) =>
      log("Web server step-aside request", {
        outcome,
        ownVersion: packageVersion(),
        callerVersion,
      });
    if (!isLoopbackAddress(remoteAddress)) {
      record("refused_auth");
      return this.jsonResponse({ success: false, error: "Loopback caller required" }, 403);
    }
    if (!callerVersion || !isOlderVersion(packageVersion(), callerVersion)) {
      record("refused_not_newer");
      return this.jsonResponse({ success: false, error: "Caller is not newer" }, 409);
    }
    record("stepped_aside");
    this.scheduleStepAside();
    return this.jsonResponse({ success: true }, 202);
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

    const tokens = await import("./api-tokens.js");
    try {
      // `webServerApiToken` is imported into the token table once, then no longer read.
      if (tokens.importConfigApiToken(this.config.apiToken)) {
        log("Imported webServerApiToken into the API token table");
      }
    } catch (error) {
      log("Importing webServerApiToken failed", {
        code: error instanceof Error ? error.name : "unknown",
      });
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
      void import("../importer/claude-hook-api.js")
        .then(({ startClaudeCodeWorker }) => startClaudeCodeWorker())
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
      } else if (this.onStepAsideCallback && (await this.ownerIsNewer())) {
        // A standalone web app behind a newer one would serve old code after a restart.
        this.stopHealthCheckLoop();
        log("Web server waiter retired", { ownVersion: packageVersion() });
        try {
          await this.onStepAsideCallback();
        } catch (error) {
          log("Step-aside callback error", { error: String(error) });
        }
      }
    }, 5000);
  }

  private async ownerIsNewer(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getUrl()}/api/web/status`, {
        headers: { [AUTH_HEADER]: getOrCreateAuthToken() },
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return false;
      const { version } = (await response.json()) as { version?: unknown };
      return typeof version === "string" && isOlderVersion(packageVersion(), version);
    } catch {
      return false;
    }
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
    const { opencodeSnapshots, stopStandaloneOpencodeReads } =
      await import("../importer/web-import-api.js");
    await opencodeSnapshots.closeAll();
    await stopStandaloneOpencodeReads();
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  isServerOwner(): boolean {
    return this.isOwner;
  }

  getUrl(): string {
    return webServerUrl(this.config.host, this.config.port);
  }

  async checkServerAvailable(): Promise<boolean> {
    try {
      // Only a web app on this machine answers here, so the local token file is enough.
      const headers = { [AUTH_HEADER]: getOrCreateAuthToken() };
      const endpoint = "/api/health";
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

  private async handleRequest(req: Request, remoteAddress?: string): Promise<Response> {
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
      const tokenFailure = authorizeApiRequest(req);
      if (tokenFailure) {
        if (path === "/api/web/step-aside") {
          log("Web server step-aside request", {
            outcome: "refused_auth",
            ownVersion: packageVersion(),
            callerVersion: "",
          });
        }
        if (method === "POST" && (path === "/api/web/stop" || path === "/api/web/restart")) {
          log("Web server power request", {
            action: path === "/api/web/stop" ? "stop" : "restart",
            outcome: "refused_auth",
            ownVersion: packageVersion(),
          });
        }
        return tokenFailure;
      }
    }

    if (path.startsWith("/api/settings") && !["GET", "HEAD"].includes(method)) {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
        return this.jsonResponse({ error: "JSON content type required" }, 415);
      }
      if (!isLoopbackHost(this.config.host) && !auth?.isEnabled()) {
        const denied = authorizeApiRequest(req);
        if (denied) return denied;
      }
    }

    try {
      if (path === "/api/health" && method === "GET") {
        return this.jsonResponse({
          success: true,
          status: "ok",
          authEnabled: auth?.isEnabled() ?? false,
          // Opaque per process; a restart finds its copy by it even behind basic auth.
          instance: PROCESS_INSTANCE,
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
        const snapshot = getSettingsSnapshot(this.config.directory ?? process.cwd());
        // The Keys card needs evidence that Claude Code uses OMMS; the default folder is not enough.
        let attempts = false;
        try {
          const { hasCaptureAttempts } = await import("./capture-attempt-store.js");
          attempts = await hasCaptureAttempts("claude-code");
        } catch {
          // No diagnostics store yet: no evidence.
        }
        return this.jsonResponse({
          ...snapshot,
          claudeCodeEvidence: { attempts, folderSet: snapshot.claudeFolder.source === "setting" },
        });
      }

      if (path === "/api/settings/backfill" && method === "GET") {
        const [
          { CONFIG },
          { readBackfillStatus, readUnresolvedDirectories, visibleUnresolvedCount },
        ] = await Promise.all([import("../config.js"), import("./backfill-state.js")]);
        // Read at request time from the Directory maps list, so the badge and the
        // list agree and an Ignore click changes every badge at once. The list
        // hides ignored directories and directories with a saved map.
        const hidden = [
          ...(CONFIG.importIgnoredDirectories ?? []),
          ...CONFIG.importPathMaps.map((map) => map.from),
        ];
        const status = async (host: "pi" | "opencode" | "claude-code") => {
          const current = await readBackfillStatus(host);
          if (!current) return current;
          // A damaged list must not hide the host's status: keep the run's count.
          const directories = await readUnresolvedDirectories(host).catch(() => null);
          if (!directories) return current;
          const unresolved = visibleUnresolvedCount(current.counts.unresolved, directories, hidden);
          return { ...current, counts: { ...current.counts, unresolved } };
        };
        const [pi, opencode, claudeCode] = await Promise.all([
          status("pi"),
          status("opencode"),
          status("claude-code"),
        ]);
        return this.jsonResponse({ pi, opencode, "claude-code": claudeCode });
      }

      if (path === "/api/settings/backfill/runs" && method === "GET") {
        return this.jsonResponse(await (await this.backfillControls()).status());
      }

      const backfillAction =
        /^\/api\/settings\/backfill\/(pi|opencode|claude-code)\/(run|pause|resume)$/.exec(path);
      if (backfillAction && method === "POST") {
        const host = backfillAction[1] as "pi" | "opencode" | "claude-code";
        const controls = await this.backfillControls();
        const cwd = this.config.directory ?? process.cwd();
        return this.importResponse(() =>
          backfillAction[2] === "pause"
            ? controls.pause(host)
            : backfillAction[2] === "resume"
              ? controls.resume(host, cwd)
              : controls.runNow(host, cwd)
        );
      }

      // The page shows the power button only when this says the caller may control the web app.
      if (path === "/api/web/status" && method === "GET") {
        return this.jsonResponse({
          version: packageVersion(),
          canControl: isLoopbackAddress(remoteAddress) && this.onPowerActionCallback !== null,
          // Keys, tokens, and the embedder can be changed only from this machine.
          isLocal: isLoopbackAddress(remoteAddress),
          instance: PROCESS_INSTANCE,
          update: this.webUpdate?.status() ?? NO_UPDATE,
        });
      }

      if ((path === "/api/web/stop" || path === "/api/web/restart") && method === "POST") {
        return this.handlePowerAction(path === "/api/web/stop" ? "stop" : "restart", remoteAddress);
      }

      if (path === "/api/web/update" && method === "POST") {
        return this.handleUpdate(remoteAddress);
      }

      if (path === "/api/web/step-aside" && method === "POST") {
        const body = await req.json().catch(() => null);
        return this.handleStepAside(remoteAddress, body);
      }

      if (path === "/api/settings/version" && method === "GET") {
        const [{ packageVersion }, { globalCommandVersion, globalRelation }] = await Promise.all([
          import("./package-version.js"),
          import("./global-version.js"),
        ]);
        const running = packageVersion();
        const global = globalCommandVersion();
        return this.jsonResponse({
          running,
          global: global.version,
          globalPath: global.path,
          mismatch: global.version !== null && global.version !== running,
          relation: globalRelation(running, global.version),
        });
      }

      if (path === "/api/settings/web-autostart" && method === "GET") {
        const { webAutostartStatus } = await import("./web-autostart.js");
        return this.jsonResponse(webAutostartStatus());
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
        if (body.edits.captureRetryRetentionHours === 0) {
          // Turning the queue off removes waiting turns now, not at the next cleanup.
          try {
            const [{ CONFIG }, { pruneCaptureRetries }] = await Promise.all([
              import("../config.js"),
              import("./capture-retry-queue.js"),
            ]);
            await pruneCaptureRetries({ ...CONFIG, captureRetryRetentionHours: 0 });
          } catch (error) {
            log("Settings saved, but clearing the capture retry queue failed", {
              code: error instanceof Error ? error.name : "unknown",
            });
          }
        }
        return this.jsonResponse(result);
      }

      if (path === "/api/settings/external-api/key" && method === "POST") {
        // The body can hold a pasted key: never log it, and never echo it back.
        const body = (await req.json()) as Record<string, unknown> | null;
        const { MemoryKeySourceError, parseMemoryKeySource, storeMemoryKeySource } =
          await import("./memory-key-source.js");
        try {
          const request = parseMemoryKeySource(body);
          if (
            request.source === "paste" &&
            !isLoopbackHost(this.config.host) &&
            !auth?.isEnabled()
          ) {
            return this.jsonResponse(
              { error: "Saving a key requires Basic Auth on network hosts" },
              403
            );
          }
          if (typeof body?.revision !== "string") {
            return this.jsonResponse({ error: "Revision required" }, 400);
          }
          const stored = await storeMemoryKeySource(request);
          const { writeGlobalConfigKeys } = await import("./global-config-writer.js");
          const result = await writeGlobalConfigKeys(
            { memoryApiKey: stored.reference },
            body.revision
          );
          const { refreshConfigIfChanged } = await import("../config.js");
          refreshConfigIfChanged(this.config.directory ?? process.cwd());
          const { memoryKeyStatus } = await import("./settings-snapshot.js");
          return this.jsonResponse({ ...result, key: memoryKeyStatus(stored.reference) });
        } catch (error) {
          const status =
            error instanceof MemoryKeySourceError
              ? error.status
              : ((error as { status?: number }).status ?? 400);
          const message = error instanceof Error ? error.message : "Key source not saved";
          const secret = typeof body?.value === "string" ? body.value.trim() : "";
          return this.jsonResponse(
            { error: secret ? message.replaceAll(secret, "[redacted]") : message },
            status
          );
        }
      }

      if (path === "/api/settings/tokens" || path.startsWith("/api/settings/tokens/")) {
        return this.handleTokenRoute(req, path, method, remoteAddress);
      }

      if (path === "/api/settings/profiles" || path.startsWith("/api/settings/profiles/")) {
        const response = await this.handleProfilesRoute(req, path, method);
        if (response) return response;
      }

      if (path.startsWith("/api/settings/profile/catch-up")) {
        const response = await this.handleCatchUpRoute(req, path, method, remoteAddress);
        if (response) return response;
      }

      if (path === "/api/settings/web-password" && method === "POST") {
        return this.handleWebPassword(req, remoteAddress);
      }

      if (path.startsWith("/api/settings/embedding")) {
        const response = await this.handleEmbeddingRoute(req, path, method, remoteAddress);
        if (response) return response;
      }

      if (path === "/api/settings/external-api/test" && method === "POST") {
        const { testExternalApi } = await import("../importer/web-import-api.js");
        return this.jsonResponse(await testExternalApi());
      }

      if (path === "/api/settings/import-maps" && method === "GET") {
        const { directoryMapsView, readStoreProjects } =
          await import("../importer/web-import-api.js");
        // Every save on the page reloads this list; the store's projects rarely change.
        if (!this.storeProjects || Date.now() - this.storeProjects.readAt > 60_000) {
          this.storeProjects = {
            readAt: Date.now(),
            projects: readStoreProjects(this.config.directory ?? process.cwd()),
          };
        }
        const knownProjects = await this.storeProjects.projects;
        // An empty result is a failed read or no store yet; try again next time.
        if (!knownProjects.length) this.storeProjects = undefined;
        return this.jsonResponse(await directoryMapsView({ knownProjects }));
      }

      if (path === "/api/settings/models" && method === "GET") {
        const { listOpencodeSettingsModels, listPiSettingsModels } =
          await import("../importer/settings-models.js");
        const host = url.searchParams.get("host");
        if (host === "pi") return this.jsonResponse(await listPiSettingsModels());
        if (host === "opencode") return this.jsonResponse(await listOpencodeSettingsModels());
        return this.jsonResponse({ error: "Invalid host" }, 400);
      }

      if (path === "/api/settings/diagnostics" && method === "GET") {
        const [{ queryCaptureAttempts }, { CONFIG }, { countCaptureRetries }] = await Promise.all([
          import("./capture-attempt-store.js"),
          import("../config.js"),
          import("./capture-retry-queue.js"),
        ]);
        const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || 7));
        const host = url.searchParams.get("host") || undefined;
        if (host && !["opencode", "pi", "claude-code"].includes(host)) {
          return this.jsonResponse({ error: "Invalid host" }, 400);
        }
        return this.jsonResponse({
          ...(await queryCaptureAttempts(Date.now() - days * 86400000, Date.now(), 100, host)),
          retryQueue: await countCaptureRetries(CONFIG),
        });
      }

      const retryNow = /^\/api\/settings\/capture-retry\/(pi|opencode|claude-code)\/run$/.exec(
        path
      );
      if (retryNow && method === "POST") {
        const [{ CONFIG }, { requestCaptureRetryNow }] = await Promise.all([
          import("../config.js"),
          import("./capture-retry-drain.js"),
        ]);
        const host = retryNow[1] as "pi" | "opencode" | "claude-code";
        return this.jsonResponse({ result: await requestCaptureRetryNow(host, CONFIG) });
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
            apiTokenSet: (await import("./api-tokens.js")).hasUnexpiredApiToken(),
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
        if (body?.host !== "pi" && body?.host !== "opencode" && body?.host !== "claude-code") {
          return this.jsonResponse({ error: "Choose Pi, OpenCode, or Claude Code" }, 400);
        }
        const [{ browseImportSources }, { CONFIG }] = await Promise.all([
          import("../importer/web-import-api.js"),
          import("../config.js"),
        ]);
        return this.importResponse(() =>
          browseImportSources(
            body.host as "pi" | "opencode" | "claude-code",
            body.path,
            CONFIG.claudeConfigDir
          )
        );
      }

      if (path === "/api/settings/imports/sources/validate" && method === "POST") {
        const body = (await req.json()) as { host?: unknown; path?: unknown };
        if (body?.host !== "pi" && body?.host !== "opencode" && body?.host !== "claude-code") {
          return this.jsonResponse({ error: "Choose Pi, OpenCode, or Claude Code" }, 400);
        }
        const { validateImportSource } = await import("../importer/web-import-api.js");
        return this.importResponse(() =>
          validateImportSource(body.host as "pi" | "opencode" | "claude-code", body.path)
        );
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
        const keyword = url.searchParams.get("keyword") || undefined;
        const result = await handleListMemories(tag, page, pageSize, includePrompts, keyword);
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

      if (
        (path === "/api/claude/retrieve" || path === "/api/claude/capture") &&
        method === "POST"
      ) {
        return this.claudeHookResponse(req, path);
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
