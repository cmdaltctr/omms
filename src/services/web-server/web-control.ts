import { randomUUID } from "node:crypto";
import { log } from "../logger.js";
import { packageVersion } from "../package-version.js";
import { isOlderVersion } from "../version-compare.js";
import { isLoopbackAddress } from "../web-api-auth.js";
import type { UpdateStatus, WebUpdate } from "../web-update.js";
import { spaceStatus, type SpaceConfig } from "../space-routes.js";
import { PortOwnership } from "./port-ownership.js";
import { jsonResponse } from "./static-files.js";

/*
 * The page's power button and update, and the step-aside request a newer
 * web app sends to the owner: the /api/web/* routes.
 */

export type PowerAction = "stop" | "restart";

const STEP_ASIDE_HOLD_OFF_MS = 60_000;
/** What a web app without an npm check reports, such as one inside a host session. */
const NO_UPDATE: UpdateStatus = { available: null, state: "idle", code: null, canInstall: false };
/** Lets the 202 reply reach the caller before the server stops. */
const STEP_ASIDE_REPLY_GRACE_MS = 100;
/**
 * Differs between processes, so the page can tell a restarted web app from the old one.
 * A restart names its copy's instance, so it can tell its copy from another web app.
 */
export const PROCESS_INSTANCE = /^[0-9a-f-]{36}$/.test(process.env.OMMS_WEB_INSTANCE ?? "")
  ? process.env.OMMS_WEB_INSTANCE!
  : randomUUID();
// Child processes, such as an OpenCode model list, must not report the same instance.
delete process.env.OMMS_WEB_INSTANCE;

export abstract class WebControl extends PortOwnership {
  private onPowerActionCallback: ((action: PowerAction) => unknown) | null = null;
  private webUpdate: Pick<WebUpdate, "status" | "requestInstall"> | null = null;
  powerActionRunning = false; // public: the automatic update stays quiet while one runs
  protected stepAsideTimer: NodeJS.Timeout | null = null;
  protected holdOffTimer: NodeJS.Timeout | null = null;

  abstract stop(): Promise<void>;

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
      return jsonResponse({ success: false, error: "Loopback caller required" }, 403);
    }
    const callback = this.onPowerActionCallback;
    if (!callback) {
      record("unsupported");
      return jsonResponse({ success: false, error: "Not supported by this web app" }, 409);
    }
    // An update restarts through the same callback; a Stop or Restart now would cut npm off.
    const updateState = this.webUpdate?.status().state;
    if (updateState === "installing" || updateState === "restarting") {
      record("refused_update_running");
      return jsonResponse({ success: false, error: "An update is running" }, 409);
    }
    // A repeated request must not start a second stop or restart while one runs.
    if (this.powerActionRunning) {
      record("already_running");
      return jsonResponse({ success: true }, 202);
    }
    this.powerActionRunning = true;
    record(action === "stop" ? "stopping" : "restarting");
    // Let the 202 reply reach the caller before the web app goes down.
    setTimeout(async () => {
      try {
        await callback(action);
      } catch (error) {
        log("Power action callback error", { action, error: String(error) }, "error");
      } finally {
        this.powerActionRunning = false;
      }
    }, STEP_ASIDE_REPLY_GRACE_MS).unref();
    return jsonResponse({ success: true }, 202);
  }

  /** Install the npm release and restart onto it. Same guards as Restart. */
  private handleUpdate(remoteAddress: string | undefined): Response {
    const record = (outcome: string) =>
      log("Web server update request", { outcome, ownVersion: packageVersion() });
    if (!isLoopbackAddress(remoteAddress)) {
      record("refused_not_loopback");
      return jsonResponse({ success: false, error: "Loopback caller required" }, 403);
    }
    if (this.powerActionRunning) {
      record("refused_power_running");
      return jsonResponse({ success: false, error: "A stop or restart is running" }, 409);
    }
    const reply = this.webUpdate?.requestInstall() ?? "cannot-install";
    record(reply);
    if (reply === "accepted") return jsonResponse({ success: true }, 202);
    const error = reply === "no-update" ? "No newer release" : "This web app cannot install";
    return jsonResponse({ success: false, error }, 409);
  }

  private scheduleStepAside(): void {
    if (this.stepAsideTimer) return;
    this.stepAsideTimer = setTimeout(async () => {
      this.stepAsideTimer = null;
      if (this.onStepAsideCallback) {
        try {
          await this.onStepAsideCallback();
        } catch (error) {
          log("Step-aside callback error", { error: String(error) }, "error");
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
    // `web update` replaces a web app of any version; other callers must be newer.
    const replace = Boolean(body && (body as { replace?: unknown }).replace === true);
    const record = (outcome: string) =>
      log("Web server step-aside request", {
        outcome,
        ownVersion: packageVersion(),
        callerVersion,
        replace,
      });
    if (!isLoopbackAddress(remoteAddress)) {
      record("refused_auth");
      return jsonResponse({ success: false, error: "Loopback caller required" }, 403);
    }
    if (!callerVersion || (!replace && !isOlderVersion(packageVersion(), callerVersion))) {
      record("refused_not_newer");
      return jsonResponse({ success: false, error: "Caller is not newer" }, 409);
    }
    record("stepped_aside");
    this.scheduleStepAside();
    return jsonResponse({ success: true }, 202);
  }

  /** The /api/web/* routes, or null for any other path. */
  protected async webControlRoute(
    req: Request,
    path: string,
    method: string,
    remoteAddress: string | undefined,
    configModule: SpaceConfig
  ): Promise<Response | null> {
    // The page shows the power button only when this says the caller may control the web app.
    if (path === "/api/web/status" && method === "GET") {
      return jsonResponse({
        version: packageVersion(),
        canControl: isLoopbackAddress(remoteAddress) && this.onPowerActionCallback !== null,
        // Keys, tokens, and the embedder can be changed only from this machine.
        isLocal: isLoopbackAddress(remoteAddress),
        instance: PROCESS_INSTANCE,
        update: this.webUpdate?.status() ?? NO_UPDATE,
        activeSpace: spaceStatus(configModule, this.config.directory ?? process.cwd()),
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
    return null;
  }
}
