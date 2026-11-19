import { log } from "../logger.js";
import { packageVersion } from "../package-version.js";
import { isOlderVersion } from "../version-compare.js";
import { AUTH_HEADER, getOrCreateAuthToken } from "../auth-token.js";
import { webServerUrl } from "../web-api-auth.js";
import { setSingleFlightInterval } from "../single-flight.js";
import type { WebAuth } from "../web-auth.js";
import type { PortableServerHandle } from "./serve-fetch.js";

/*
 * Port ownership: one web app owns the port, the others wait. A waiter checks
 * the owner every five seconds, takes the port when the owner is gone, falls
 * back to a neighbour port when the port is held by a dead socket, and
 * retires when the owner is newer or `web update` asked it to.
 */

const MIN_FAILED_TAKEOVERS = 3;
/** A busy owner can answer late. Two seconds was short enough to call a live owner dead. */
const HEALTH_CHECK_TIMEOUT_MS = 8_000;

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

export interface WebServerConfig {
  port: number;
  host: string;
  directory?: string;
  enabled: boolean;
  auth?: WebAuth;
  apiToken?: string;
  /** How long a stepped-aside server waits before it may take the port back. */
  stepAsideHoldOffMs?: number;
  /** Test seam: the retire marker's time, or null. Defaults to `~/.omms/web-retire.json`. */
  readRetireMarker?: () => number | null;
}

export abstract class PortOwnership {
  protected server: PortableServerHandle | null = null;
  protected config: WebServerConfig;
  protected isOwner: boolean = false;
  protected startPromise: Promise<void> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private onTakeoverCallback: (() => Promise<void>) | null = null;
  private onPortsExhaustedCallback: (() => void) | null = null;
  protected onStepAsideCallback: (() => void | Promise<void>) | null = null;
  /** `web update` retires waiting web apps that started before its marker. */
  private readonly startedAt = Date.now();
  private portsExhaustedNotified = false;
  private takeoverFailures: number = 0;
  /** Counts stops of the health loop, so a takeover can see a stop() during its wait. */
  private loopStops = 0;
  private lastHealthFailure: string | null = null;
  private readonly maxFallbackPort: number;

  constructor(config: WebServerConfig) {
    this.config = config;
    this.maxFallbackPort = config.port + 10;
  }

  /** Binds the port; the takeover loop calls it again when the owner is gone. */
  protected abstract _start(): Promise<void>;

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

  protected startHealthCheckLoop(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setSingleFlightInterval(() => this.waiterTick(), 5000);
  }

  /** One check of a web app that waits for the port. */
  private async waiterTick(): Promise<void> {
    const isAvailable = await this.checkServerAvailable();
    // The owner answers, so earlier failed takeovers were not a dead socket.
    if (isAvailable) this.takeoverFailures = 0;
    const reason = await this.retireReason(isAvailable);
    if (!reason) {
      if (isAvailable) return;
      this.stopHealthCheckLoop();
      await this.attemptTakeover();
      return;
    }
    this.stopHealthCheckLoop();
    log("Web server waiter retired", { ownVersion: packageVersion(), reason });
    try {
      await this.onStepAsideCallback?.();
    } catch (error) {
      log("Step-aside callback error", { error: String(error) }, "error");
    }
  }

  /**
   * Why a standalone waiter should exit, or null. A standalone web app behind a
   * newer one would serve old code after a restart. A retire request also
   * stands when the owner is gone, so it is checked before a takeover.
   */
  private async retireReason(ownerAnswers: boolean): Promise<string | null> {
    if (!this.onStepAsideCallback) return null;
    if (await this.retiredByUpdate()) return "update";
    return ownerAnswers && (await this.ownerIsNewer()) ? "newer-owner" : null;
  }

  /** True when `web update` asked web apps started before this one to retire. */
  private async retiredByUpdate(): Promise<boolean> {
    try {
      const read =
        this.config.readRetireMarker ?? (await import("../web-retire.js")).readRetireMarker;
      const before = read();
      return before !== null && this.startedAt < before;
    } catch {
      return false;
    }
  }

  private async ownerIsNewer(): Promise<boolean> {
    try {
      // Basic Auth guards the status route. The owner reads the same config, so send ours.
      const basic = this.config.auth?.authorizationHeader();
      const response = await fetch(`${this.getUrl()}/api/web/status`, {
        headers: {
          [AUTH_HEADER]: getOrCreateAuthToken(),
          ...(basic ? { Authorization: basic } : {}),
        },
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return false;
      const { version } = (await response.json()) as { version?: unknown };
      return typeof version === "string" && isOlderVersion(packageVersion(), version);
    } catch {
      return false;
    }
  }

  protected stopHealthCheckLoop(): void {
    // stop() runs this too, so a takeover in flight sees the change and gives up.
    this.loopStops += 1;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async attemptTakeover(): Promise<void> {
    // prevent thundering herd: multiple non-owners racing to bind port
    const jitterMs = 500 + Math.random() * 1000;
    const stops = this.loopStops;
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
    const available = await this.checkServerAvailable();
    if (stops !== this.loopStops) return;

    if (available) {
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
      log(
        "Web server port held by a non-responsive process; falling back to next port",
        {
          previousPort: this.config.port,
          newPort: nextPort,
          lastFailure: this.lastHealthFailure,
          healthTimeoutMs: HEALTH_CHECK_TIMEOUT_MS,
        },
        "warn"
      );
      this.config.port = nextPort;
    }

    try {
      // Reset startPromise so _start() can run again
      this.startPromise = null;
      await this._start();
    } catch {
      this.startHealthCheckLoop();
    }
    if (!this.isOwner) {
      if (
        this.config.port >= this.maxFallbackPort &&
        this.takeoverFailures >= MIN_FAILED_TAKEOVERS
      ) {
        // Every candidate port is held by a non-responsive process, and the
        // last one just failed to bind. Stop the health loop instead of
        // retrying every five seconds forever.
        this.stopHealthCheckLoop();
        this.notifyPortsExhausted();
      }
      return;
    }

    this.takeoverFailures = 0;
    log("Web server takeover successful", { port: this.config.port });

    if (this.onTakeoverCallback) {
      try {
        await this.onTakeoverCallback();
      } catch (error) {
        log("Takeover callback error", { error: String(error) }, "error");
      }
    }
  }

  private notifyPortsExhausted(): void {
    if (this.portsExhaustedNotified) return;
    this.portsExhaustedNotified = true;
    log(
      "Web server unavailable: every candidate port is held by a non-responsive process",
      {
        port: this.config.port,
        maxFallbackPort: this.maxFallbackPort,
      },
      "warn"
    );
    try {
      this.onPortsExhaustedCallback?.();
    } catch (error) {
      log("Ports exhausted callback error", { error: String(error) }, "error");
    }
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

  /** Why the last `checkServerAvailable` call said no, or null when it said yes. */
  getLastHealthFailure(): string | null {
    return this.lastHealthFailure;
  }

  async checkServerAvailable(): Promise<boolean> {
    try {
      // Only a web app on this machine answers here, so the local token file is enough.
      const headers = { [AUTH_HEADER]: getOrCreateAuthToken() };
      const endpoint = "/api/health";
      const response = await fetch(`${this.getUrl()}${endpoint}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.lastHealthFailure = `http ${response.status}`;
        return false;
      }
      // Fallback spans 10 neighbor ports; any 2xx from an unrelated local
      // service must not be mistaken for an omms owner. Require the
      // response to carry our API envelope.
      const body = (await response.json()) as { success?: boolean; status?: string };
      const ok = body.success === true && (endpoint !== "/api/health" || body.status === "ok");
      this.lastHealthFailure = ok ? null : "unexpected response";
      return ok;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      this.lastHealthFailure =
        name === "TimeoutError"
          ? "timeout"
          : error instanceof Error
            ? error.message
            : String(error);
      return false;
    }
  }
}
