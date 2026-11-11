import type { Context } from "@opencode/plugin/promise/plugin";
import { resolve } from "node:path";
import { CONFIG, isConfigured } from "../config.js";
import type { AutoCaptureHost } from "../core/host.js";
import { isInternalCaptureSessionTitle } from "../adapters/opencode/internal-capture-sessions.js";
import { log } from "../services/logger.js";

/** Capture waits this long after a session goes idle, so a quick follow-up prompt wins. */
export const IDLE_CAPTURE_DELAY_MS = 10_000;

export type SessionEvent = { readonly type: string; readonly properties: any };

/** Map a raw V2 event onto the names the capture path reads. */
export function toSessionEvent(raw: any): SessionEvent {
  const envelope = raw?.payload ?? raw;
  const source = envelope?.type === "sync" && envelope.syncEvent ? envelope.syncEvent : envelope;
  const rawType = typeof source?.type === "string" ? source.type.replace(/\.1$/, "") : source?.type;
  const data = source?.data ?? {};
  // OpenCode 2.0.14 ends a turn with `session.execution.succeeded` and emits no
  // `session.idle`; some builds report idleness through `session.status`. Both
  // mean the session is idle. Subscribed events carry their payload in `data`;
  // bus-style ones in `properties`.
  const payload = source?.data ?? source?.properties ?? {};
  if (
    rawType === "session.execution.succeeded" ||
    (rawType === "session.status" && payload?.status?.type === "idle")
  ) {
    return { type: "session.idle", properties: { sessionID: payload.sessionID } };
  }
  const type = rawType === "session.compaction.ended" ? "session.compacted" : rawType;
  if (source && typeof source === "object" && "properties" in source) {
    return { type, properties: source.properties };
  }
  if (type === "session.created" || type === "session.updated") {
    return { type, properties: { info: data.session ?? data.info ?? data } };
  }
  return { type, properties: data };
}

/** True when a raw event names this plugin's directory, directly or through its session. */
export async function eventBelongsToLocation(ctx: Context, raw: any): Promise<boolean> {
  const directory =
    raw?.location?.directory ??
    raw?.directory ??
    raw?.payload?.location?.directory ??
    raw?.payload?.directory ??
    raw?.data?.info?.directory;
  if (typeof directory === "string") {
    return resolve(directory) === resolve(ctx.location.directory);
  }

  const data = raw?.data ?? raw?.payload?.data ?? raw?.properties;
  const sessionID = data?.sessionID ?? data?.session?.id ?? data?.info?.id;
  if (!sessionID) return false;
  try {
    const session: any = await ctx.session.get({ sessionID });
    const sessionDirectory =
      session?.location?.directory ?? session?.directory ?? session?.data?.directory;
    return (
      typeof sessionDirectory === "string" &&
      resolve(sessionDirectory) === resolve(ctx.location.directory)
    );
  } catch {
    return false;
  }
}

/**
 * True for a session that OMMS created for its own model calls. Current versions generate
 * without a session; older versions left sessions titled `omms capture`.
 */
export async function isInternalOpencodeSession(
  session: Pick<Context["session"], "get">,
  sessionID: string
): Promise<boolean> {
  try {
    const info: any = await session.get({ sessionID });
    return isInternalCaptureSessionTitle(info?.title);
  } catch (error) {
    log("internal capture session check failed", { sessionID, error: String(error) }, "error");
    return false;
  }
}

export type SessionEventDeps = {
  readonly session: Pick<Context["session"], "get">;
  readonly directory: string;
  readonly autoCaptureHost: AutoCaptureHost;
  /** Profile learning for this plugin's directory; runs after capture. */
  readonly learnProfile: () => Promise<void>;
};

/** Start capture, skill-turn recording, profile learning and the retry drain from session events. */
export function createOpencodeSessionEvents(deps: SessionEventDeps) {
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;

  const onCreated = async (event: SessionEvent) => {
    if (!isConfigured() || !CONFIG.autoCaptureEnabled) return;
    const sessionID = event.properties?.info?.id ?? event.properties?.sessionID;
    // OMMS's own structured-output sessions must not start a retry pass.
    if (sessionID && (await isInternalOpencodeSession(deps.session, sessionID))) return;
    const { startCaptureRetryDrain } = await import("../services/capture-retry-drain.js");
    startCaptureRetryDrain("opencode");
  };

  const onIdle = async (event: SessionEvent) => {
    // Skill learning records turns even when memory capture is off (ADR-036).
    if (!isConfigured() || !(CONFIG.autoCaptureEnabled || CONFIG.skillLearning)) return;
    const sessionID = event.properties?.sessionID;
    if (!sessionID) return;
    // Internal sessions must not re-trigger capture or learning: that would loop
    // idle, model call, idle without end.
    if (await isInternalOpencodeSession(deps.session, sessionID)) {
      log("Skipping idle processing for internal capture session", { sessionID });
      return;
    }

    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(async () => {
      try {
        const { performAutoCapture } = await import("../services/auto-capture.js");
        await performAutoCapture(deps.autoCaptureHost, sessionID, deps.directory);
        if (!CONFIG.autoCaptureEnabled) return; // Skill turns only; the memory work stays off.
        await deps.learnProfile();
        const { cleanupService } = await import("../services/cleanup-service.js");
        if (await cleanupService.shouldRunCleanup()) await cleanupService.runCleanup();
      } catch (error) {
        log("Idle processing error", { error: String(error) }, "error");
      } finally {
        idleTimeout = null;
      }
    }, IDLE_CAPTURE_DELAY_MS);
  };

  return {
    async handle(event: SessionEvent): Promise<void> {
      if (event.type === "session.created") await onCreated(event);
      else if (event.type === "session.idle") await onIdle(event);
    },
    /** Drop pending idle work; the plugin is unloading. */
    dispose(): void {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = null;
    },
  };
}
