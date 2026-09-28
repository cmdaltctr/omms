import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { log } from "../services/logger.js";
import type { SettingsModel } from "./backfill-controls.js";
import { connectedProviderModels } from "./settings-models.js";

/**
 * Lists OpenCode's signed-in models when no OpenCode session serves the web app.
 * It starts a private `opencode serve` on loopback with its own password, reads
 * the list over HTTP, and stops the server. See docs/tdr/014 for the v2 API.
 *
 * OpenCode's `/api/model` reply holds provider API keys. Records are cut down to
 * provider, model, and name as soon as they are parsed. Nothing here logs,
 * keeps, or returns the reply body, the child's output, or the password.
 */

export type StandaloneResult =
  | { outcome: "listed"; models: SettingsModel[] }
  | { outcome: "not_found" | "start_timeout" | "empty" | "unreadable" };

interface OutputStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export interface ChildLike {
  pid?: number;
  stdout: OutputStream | null;
  stderr: OutputStream | null;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  once(event: "exit" | "error", listener: () => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface StandaloneDeps {
  spawn(command: string, args: string[], options: SpawnOptions): ChildLike;
  fetch(
    url: string,
    init: { headers: Record<string, string>; signal?: AbortSignal }
  ): Promise<Response>;
  now(): number;
  sleep(ms: number): Promise<void>;
  isFile(path: string): boolean;
  kill(child: ChildLike, signal: "SIGTERM" | "SIGKILL"): void;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  home: string;
  password(): string;
  log(message: string, data: Record<string, unknown>): void;
}

const START_LIMIT_MS = 10_000;
const LIST_LIMIT_MS = 5_000;
const POLL_MS = 250;
// OpenCode v2.0.18 takes about 3.6 s to exit on SIGTERM once its model list is loaded.
const KILL_WAIT_MS = 5_000;
const OUTPUT_CAP = 16 * 1024;
const LISTED_KEEP_MS = 5 * 60_000;
const FAILED_KEEP_MS = 30_000;
const SERVE_ARGS = ["serve", "--hostname=127.0.0.1", "--port=0"];

/** Stop functions for children that are still running, for the web server's shutdown. */
const liveChildren = new Set<() => Promise<void>>();

function envValue(deps: StandaloneDeps, name: string): string | undefined {
  if (deps.platform !== "win32") return deps.env[name];
  const key = Object.keys(deps.env).find((entry) => entry.toUpperCase() === name);
  return key === undefined ? undefined : deps.env[key];
}

/** Checks `~/.opencode/bin`, then `PATH`, then the usual install folders. */
function findOpencode(deps: StandaloneDeps): string | null {
  const windows = deps.platform === "win32";
  const path = windows ? win32 : posix;
  const pathFolders = (envValue(deps, "PATH") ?? "")
    .split(windows ? ";" : ":")
    .map((folder) => folder.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  const folders = [
    path.join(deps.home, ".opencode", "bin"),
    ...pathFolders,
    ...(windows ? [] : ["/opt/homebrew/bin", "/usr/local/bin"]),
    path.join(deps.home, ".bun", "bin"),
  ];
  const extensions = windows
    ? (envValue(deps, "PATHEXT") ?? ".com;.exe;.bat;.cmd").split(";").filter(Boolean)
    : [""];
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = path.join(folder, `opencode${extension}`);
      if (deps.isFile(candidate)) return candidate;
    }
  }
  return null;
}

function startServer(deps: StandaloneDeps, program: string, password: string): ChildLike {
  const options: SpawnOptions = {
    cwd: deps.home,
    env: { ...deps.env, OPENCODE_SERVER_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
  if (deps.platform === "win32" && /\.(cmd|bat)$/i.test(program)) {
    // cmd.exe with /s strips the outer quotes, so the program path keeps its own.
    const command = `""${program}" ${SERVE_ARGS.join(" ")}"`;
    return deps.spawn(envValue(deps, "COMSPEC") ?? "cmd.exe", ["/d", "/s", "/c", command], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  // A new process group on POSIX, so a wrapper script and its server stop together.
  return deps.spawn(program, SERVE_ARGS, { ...options, detached: deps.platform !== "win32" });
}

/** Resolves with the server URL, or null when the child exits or misses the limit. */
function waitForUrl(deps: StandaloneDeps, child: ChildLike, password: string) {
  return new Promise<string | null>((resolve) => {
    let output = "";
    const read = (chunk: Buffer | string) => {
      // Keep reading after the match, so a full pipe never blocks the child.
      output = (output + chunk.toString()).slice(-OUTPUT_CAP).split(password).join("[redacted]");
      const url = output.match(/listening on (https?:\/\/\S+)/)?.[1];
      if (url) resolve(url.replace(/\/+$/, ""));
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => resolve(null));
    child.once("error", () => resolve(null));
    void deps.sleep(START_LIMIT_MS).then(() => resolve(null));
  });
}

type Reply =
  | { kind: "models"; models: SettingsModel[] }
  | { kind: "not_v2" }
  | { kind: "unreadable" }
  | { kind: "no_reply" };

function mapV2(body: unknown): SettingsModel[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const models: SettingsModel[] = [];
  for (const entry of data as Array<Record<string, unknown>>) {
    const { providerID, id, name } = entry ?? {};
    if (typeof providerID !== "string" || typeof id !== "string") return null;
    models.push({
      provider: providerID,
      model: id,
      name: typeof name === "string" && name ? name : id,
    });
  }
  return models;
}

function mapV1(body: unknown): SettingsModel[] | null {
  const list = body as { all?: unknown; connected?: unknown } | null;
  if (!Array.isArray(list?.all) || !Array.isArray(list?.connected)) return null;
  try {
    return connectedProviderModels(list as Parameters<typeof connectedProviderModels>[0]);
  } catch {
    return null;
  }
}

async function readList(
  deps: StandaloneDeps,
  url: string,
  auth: string,
  route: "v2" | "v1",
  deadline: number
): Promise<Reply> {
  let response: Response;
  let text: string;
  try {
    const signal = AbortSignal.timeout(Math.max(POLL_MS, deadline - deps.now()));
    response = await deps.fetch(`${url}${route === "v2" ? "/api/model" : "/provider"}`, {
      headers: { authorization: auth },
      signal,
    });
    text = await response.text();
  } catch {
    return { kind: "no_reply" };
  }
  if (response.status === 404) return route === "v2" ? { kind: "not_v2" } : { kind: "unreadable" };
  if (!response.ok) return { kind: "no_reply" };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return route === "v2" ? { kind: "not_v2" } : { kind: "unreadable" };
  }
  const models = route === "v2" ? mapV2(body) : mapV1(body);
  return models ? { kind: "models", models } : { kind: "unreadable" };
}

/** Polls until two replies in a row have the same non-empty count, or the limit. */
async function pollModels(
  deps: StandaloneDeps,
  url: string,
  password: string
): Promise<StandaloneResult> {
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const deadline = deps.now() + LIST_LIMIT_MS;
  let route: "v2" | "v1" = "v2";
  let previous: SettingsModel[] | null = null;
  let latest: SettingsModel[] = [];
  for (;;) {
    let reply = await readList(deps, url, auth, route, deadline);
    if (reply.kind === "not_v2") {
      route = "v1";
      reply = await readList(deps, url, auth, route, deadline);
    }
    if (reply.kind === "unreadable" || reply.kind === "not_v2") return { outcome: "unreadable" };
    if (reply.kind === "models") {
      const count = reply.models.length;
      if (count > 0 && previous?.length === count)
        return { outcome: "listed", models: reply.models };
      previous = reply.models;
      if (count > 0) latest = reply.models;
    }
    if (deps.now() >= deadline) break;
    await deps.sleep(POLL_MS);
  }
  if (latest.length > 0) return { outcome: "listed", models: latest };
  return previous ? { outcome: "empty" } : { outcome: "start_timeout" };
}

/** Sends SIGTERM, then SIGKILL if the child is still running 5 seconds later. */
async function stopChild(deps: StandaloneDeps, child: ChildLike): Promise<void> {
  const running = () => child.exitCode === null && child.signalCode === null;
  if (!running()) return;
  const exited = new Promise<boolean>((resolve) => child.once("exit", () => resolve(true)));
  try {
    deps.kill(child, "SIGTERM");
  } catch {
    // The child may exit between the check and the signal.
  }
  const stopped = await Promise.race([exited, deps.sleep(KILL_WAIT_MS).then(() => false)]);
  if (!stopped && running()) {
    try {
      deps.kill(child, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

async function readOnce(deps: StandaloneDeps): Promise<StandaloneResult> {
  const began = deps.now();
  const program = findOpencode(deps);
  if (!program) {
    deps.log("OpenCode standalone model list", { outcome: "not_found", count: 0 });
    return { outcome: "not_found" };
  }
  const password = deps.password();
  let child: ChildLike | null = null;
  let stop: (() => Promise<void>) | null = null;
  let startMs: number | null = null;
  let listMs = 0;
  let result: StandaloneResult;
  try {
    const started = startServer(deps, program, password);
    child = started;
    let stopping: Promise<void> | null = null;
    stop = () => (stopping ??= stopChild(deps, started));
    liveChildren.add(stop);
    const url = await waitForUrl(deps, started, password);
    if (!url) {
      result = { outcome: "start_timeout" };
    } else {
      startMs = deps.now() - began;
      result = await pollModels(deps, url, password);
      listMs = deps.now() - began - startMs;
    }
  } catch {
    result = { outcome: child ? "unreadable" : "start_timeout" };
  } finally {
    // Stop in the background, so the page gets its list without waiting for the exit.
    if (stop) {
      const done = stop;
      void done().finally(() => liveChildren.delete(done));
    }
  }
  deps.log("OpenCode standalone model list", {
    outcome: result.outcome,
    count: result.outcome === "listed" ? result.models.length : 0,
    ...(startMs === null ? {} : { startMs, listMs }),
  });
  return result;
}

/**
 * A reader that shares one read between callers at the same time, and keeps a
 * listed result for 5 minutes and a failed one for 30 seconds.
 */
export function createStandaloneOpencodeReader(deps: StandaloneDeps) {
  let inflight: Promise<StandaloneResult> | null = null;
  let kept: { result: StandaloneResult; until: number } | null = null;
  return (): Promise<StandaloneResult> => {
    if (kept && deps.now() < kept.until) return Promise.resolve(kept.result);
    inflight ??= readOnce(deps)
      .then((result) => {
        const keepMs = result.outcome === "listed" ? LISTED_KEEP_MS : FAILED_KEEP_MS;
        kept = { result, until: deps.now() + keepMs };
        return result;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

function isProgramFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function killTree(child: ChildLike, signal: "SIGTERM" | "SIGKILL"): void {
  if (process.platform === "win32") {
    // Windows has no signals; end the whole tree, which includes a .cmd wrapper's server.
    if (child.pid)
      nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).on("error", () => child.kill(signal));
    else child.kill(signal);
    return;
  }
  try {
    if (!child.pid) throw new Error("no pid");
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

let defaultReader: (() => Promise<StandaloneResult>) | null = null;

/** Reads OpenCode's signed-in models through a private `opencode serve`. */
export function readStandaloneOpencodeModels(): Promise<StandaloneResult> {
  defaultReader ??= createStandaloneOpencodeReader({
    spawn: (command, args, options) => nodeSpawn(command, args, options),
    fetch: (url, init) => fetch(url, init),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()),
    isFile: isProgramFile,
    kill: killTree,
    env: process.env,
    platform: process.platform,
    home: homedir(),
    password: () => randomBytes(24).toString("base64url"),
    log,
  });
  return defaultReader();
}

/** Stops every child that a read started, and waits until each one has exited or been killed. */
export async function stopStandaloneOpencodeReads(): Promise<void> {
  await Promise.all([...liveChildren].map((stop) => stop()));
}
