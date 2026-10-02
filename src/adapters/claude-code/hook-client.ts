import { homedir } from "node:os";
import { AUTH_HEADER } from "../../services/auth-token.js";
import type { EnsureDeps } from "../../services/web-ensure.js";

// Claude Code hook client: read the hook input, find or start the OMMS web
// app, send one request, print the added context, and log one metadata line.
// It loads no store, embedding model, or engine; the web app does that work.

export const CLAUDE_HOOK_EVENTS = ["session-start", "user-prompt-submit", "stop"] as const;
export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

/** Claude Code caps added context at 10,000 characters; keep a margin. */
export const CLAUDE_CONTEXT_LIMIT = 9_500;
/**
 * Copy of `RETRIEVAL_SECTION_TAG` in `src/core/retrieval.ts`. That module loads
 * the store, so the hook keeps its own copy; a test checks the two match.
 */
export const RETRIEVAL_TAG = "omms-retrieval";

const INPUT_TIMEOUT_MS = 2_000;
const MAX_INPUT_BYTES = 1024 * 1024;

const BUDGETS: Record<ClaudeHookEvent, { startMs: number; requestMs: number }> = {
  "session-start": { startMs: 15_000, requestMs: 3_000 },
  "user-prompt-submit": { startMs: 5_000, requestMs: 3_000 },
  stop: { startMs: 30_000, requestMs: 5_000 },
};

const HOOK_EVENT_NAMES: Record<ClaudeHookEvent, string> = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
  stop: "Stop",
};

export interface HookServerSettings {
  enabled: boolean;
  baseUrl: string;
  basicAuth?: { username: string; password: string };
}

/** A readable byte stream such as `process.stdin`. */
export interface HookInputStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end" | "error", listener: (arg?: unknown) => void): unknown;
  removeAllListeners(): unknown;
  pause(): unknown;
  destroy?(): unknown;
}

export interface ClaudeHookOptions {
  stdin?: HookInputStream;
  writeStdout?: (text: string) => void;
  fetch?: typeof fetch;
  spawn?: EnsureDeps["spawn"];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, data: Record<string, unknown>) => void | Promise<void>;
  readToken?: () => Promise<string>;
  /** The version of the newest recorded OMMS copy, or null. Tests inject it. */
  recordedVersion?: () => string | null;
  resolveRuntime?: () => Promise<string | null>;
  loadSettings?: () => Promise<HookServerSettings>;
  /** The `om-memory-system` script that `web` is run from. */
  cliScript?: string;
  /** Overrides for the shared start rule, such as the start lock. */
  ensureDeps?: Partial<EnsureDeps>;
  inputTimeoutMs?: number;
  maxInputBytes?: number;
  /** Overrides the event's request budget. */
  requestTimeoutMs?: number;
}

export type ClaudeHookCode =
  | "ok"
  | "bad-event"
  | "no-input"
  | "bad-input"
  | "server-disabled"
  | "server-unreachable"
  | "start-timeout"
  | "timeout"
  | "network-error"
  | "bad-response"
  | "error"
  | `http-${number}`;

export interface ClaudeHookResult {
  code: ClaudeHookCode;
  spawned: boolean;
  inputBytes: number;
  outputBytes: number;
}

/** Read stdin up to a time and size limit. Late, oversized, or broken input is no input. */
export function readHookInput(
  stream: HookInputStream,
  limits: { timeoutMs: number; maxBytes: number }
): Promise<{ text: string | null; bytes: number }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (complete: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeAllListeners();
      stream.pause();
      // Let the process exit even though the writer has not closed stdin.
      if (!complete) stream.destroy?.();
      const text = complete && bytes <= limits.maxBytes ? Buffer.concat(chunks).toString() : null;
      resolve({ text, bytes });
    };
    const timer = setTimeout(() => finish(false), limits.timeoutMs);
    stream.on("data", (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buffer.length;
      if (bytes > limits.maxBytes) return finish(false);
      chunks.push(buffer);
    });
    stream.on("end", () => finish(true));
    stream.on("error", () => finish(false));
  });
}

/** Cut text to the limit. When it ends with the retrieval tag, keep that closing tag. */
export function truncateContext(text: string, limit = CLAUDE_CONTEXT_LIMIT): string {
  if (text.length <= limit) return text;
  const close = `</${RETRIEVAL_TAG}>`;
  const suffix = text.trimEnd().endsWith(close) ? `\n${close}` : "";
  let head = text.slice(0, limit - suffix.length);
  // Do not leave half of a surrogate pair at the cut.
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return head + suffix;
}

type HookInput = Record<string, unknown> & { session_id: string; cwd: string };

function parseInput(text: string, event: ClaudeHookEvent): HookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.session_id !== "string" || typeof input.cwd !== "string") return null;
  if (event === "stop" && typeof input.transcript_path !== "string") return null;
  return input as HookInput;
}

function requestFor(event: ClaudeHookEvent, input: HookInput): { path: string; body: object } {
  const optional = (key: string) => (input[key] === undefined ? {} : { [key]: input[key] });
  if (event === "stop")
    return {
      path: "/api/claude/capture",
      body: {
        session_id: input.session_id,
        transcript_path: input.transcript_path,
        cwd: input.cwd,
        ...optional("last_assistant_message"),
        ...optional("stop_hook_active"),
      },
    };
  return {
    path: "/api/claude/retrieve",
    body: {
      event,
      session_id: input.session_id,
      cwd: input.cwd,
      ...optional("transcript_path"),
      ...optional(event === "session-start" ? "source" : "prompt"),
    },
  };
}

function productionDefaults(): Required<
  Omit<
    ClaudeHookOptions,
    | "requestTimeoutMs"
    | "inputTimeoutMs"
    | "maxInputBytes"
    | "spawn"
    | "recordedVersion"
    | "resolveRuntime"
    | "cliScript"
    | "ensureDeps"
  >
> {
  return {
    stdin: process.stdin,
    writeStdout: (text) => process.stdout.write(text),
    fetch: globalThis.fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // The shared logger only uses the file system; load it lazily anyway.
    log: async (message, data) => (await import("../../services/logger.js")).log(message, data),
    readToken: async () => (await import("../../services/auth-token.js")).getOrCreateAuthToken(),
    loadSettings: loadWebSettings,
  };
}

/** Port, bind address, and auth as `om-memory-system web` reads them (global config from home). */
async function loadWebSettings(): Promise<HookServerSettings> {
  const config = await import("../../config.js");
  config.initConfig(homedir());
  const { CONFIG } = config;
  const { webServerUrl } = await import("../../services/web-api-auth.js");
  const settings: HookServerSettings = {
    enabled: CONFIG.webServerEnabled,
    baseUrl: webServerUrl(CONFIG.webServerHost, CONFIG.webServerPort),
  };
  const password = (CONFIG.webServerAuthPassword ?? "").trim();
  if (password) {
    const { WebAuth } = await import("../../services/web-auth.js");
    const { username } = new WebAuth({
      password,
      username: CONFIG.webServerAuthUsername,
    }).getConfig();
    settings.basicAuth = { username, password };
  }
  return settings;
}

/** Run one hook event. Never throws; the result says what happened. */
export async function runClaudeHook(
  event: ClaudeHookEvent,
  options: ClaudeHookOptions = {}
): Promise<ClaudeHookResult> {
  const deps = { ...productionDefaults(), ...options };
  const started = deps.now();
  const result: ClaudeHookResult = { code: "ok", spawned: false, inputBytes: 0, outputBytes: 0 };
  try {
    result.code = await runSteps(event, deps, result);
  } catch {
    result.code = "error";
  }
  try {
    await deps.log("Claude Code hook", {
      event,
      code: result.code,
      elapsedMs: deps.now() - started,
      spawned: result.spawned,
      inputBytes: result.inputBytes,
      outputBytes: result.outputBytes,
    });
  } catch {
    /* A failed log line must not break the hook. */
  }
  return result;
}

type Deps = ReturnType<typeof productionDefaults> & ClaudeHookOptions;

async function runSteps(
  event: ClaudeHookEvent,
  deps: Deps,
  result: ClaudeHookResult
): Promise<ClaudeHookCode> {
  const raw = await readHookInput(deps.stdin, {
    timeoutMs: deps.inputTimeoutMs ?? INPUT_TIMEOUT_MS,
    maxBytes: deps.maxInputBytes ?? MAX_INPUT_BYTES,
  });
  result.inputBytes = raw.bytes;
  if (!raw.text?.trim()) return "no-input";
  const input = parseInput(raw.text, event);
  if (!input) return "bad-input";

  const settings = await deps.loadSettings();
  if (!settings.enabled) return "server-disabled";
  const budget = BUDGETS[event];
  const ready = await ensureServer(event, settings, budget.startMs, deps, result);
  if (ready !== "ok") return ready;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    [AUTH_HEADER]: await deps.readToken(),
  };
  if (settings.basicAuth) {
    const { username, password } = settings.basicAuth;
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  const { path, body } = requestFor(event, input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.requestTimeoutMs ?? budget.requestMs);
  let response: Response;
  try {
    response = await deps.fetch(`${settings.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return controller.signal.aborted ? "timeout" : "network-error";
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return `http-${response.status}`;
  if (event === "stop") return "ok";

  const reply = (await response.json().catch(() => null)) as { additionalContext?: unknown } | null;
  if (typeof reply?.additionalContext !== "string") return "bad-response";
  if (!reply.additionalContext) return "ok";
  const output = `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT_NAMES[event],
      additionalContext: truncateContext(reply.additionalContext),
    },
  })}\n`;
  deps.writeStdout(output);
  result.outputBytes = Buffer.byteLength(output);
  return "ok";
}

/**
 * The newest recorded copy's version with the local token and, when the web app has
 * a browser password, Basic Auth. Undefined when no copy is recorded.
 */
async function replaceOlderFor(
  settings: HookServerSettings,
  deps: Deps
): Promise<{ version: string; headers: Record<string, string> } | undefined> {
  try {
    const handoff = await import("../../services/runtime-handoff.js");
    const version = deps.recordedVersion ? deps.recordedVersion() : handoff.newestRecordedVersion();
    if (!version) return undefined;
    return {
      version,
      headers: await handoff.replaceHeaders(await deps.readToken(), {
        webServerAuthPassword: settings.basicAuth?.password,
        webServerAuthUsername: settings.basicAuth?.username,
      }),
    };
  } catch {
    // Without a target, any running web app is used.
    return undefined;
  }
}

/** Use a running web app, or start one through the shared rule and wait for it within the budget. */
async function ensureServer(
  event: ClaudeHookEvent,
  settings: HookServerSettings,
  budgetMs: number,
  deps: Deps,
  result: ClaudeHookResult
): Promise<"ok" | "server-unreachable" | "start-timeout"> {
  const { ensureWebApp } = await import("../../services/web-ensure.js");
  const answer = await ensureWebApp({
    settings: { enabled: settings.enabled, baseUrl: settings.baseUrl },
    budgetMs,
    wait: true,
    // Only a new session replaces an older web app. A prompt or a stop uses any running one.
    ...(event === "session-start" ? { replaceOlder: await replaceOlderFor(settings, deps) } : {}),
    deps: {
      fetch: deps.fetch,
      now: deps.now,
      sleep: deps.sleep,
      ...(deps.spawn ? { spawn: deps.spawn } : {}),
      ...(deps.resolveRuntime ? { resolveRuntime: deps.resolveRuntime } : {}),
      ...(deps.cliScript ? { cliScript: deps.cliScript } : {}),
      ...deps.ensureDeps,
    },
  });
  result.spawned = answer === "started";
  if (answer === "running" || answer === "started") return "ok";
  return answer === "start-timeout" ? "start-timeout" : "server-unreachable";
}
