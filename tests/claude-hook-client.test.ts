import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  CLAUDE_CONTEXT_LIMIT,
  RETRIEVAL_TAG,
  readHookInput,
  truncateContext,
  type ClaudeHookOptions,
} from "../src/adapters/claude-code/hook-client.js";
import { runClaudeHookCommand } from "../src/adapters/claude-code/hook-command.js";

const TOKEN = "local-token-123";
const BASE = "http://127.0.0.1:4747";
const SECRET_PROMPT = "please remember my secret plan zebra-42";

type Call = { url: string; method: string; headers: Record<string, string>; body?: any };

function stdinOf(text: string | null): PassThrough {
  const stream = new PassThrough();
  if (text !== null) stream.end(text);
  return stream;
}

function payload(event: string, extra: Record<string, unknown> = {}) {
  const base = { session_id: "s-1", transcript_path: "/tmp/t.jsonl", cwd: "/work/project" };
  if (event === "session-start")
    return { ...base, hook_event_name: "SessionStart", source: "startup", ...extra };
  if (event === "user-prompt-submit")
    return { ...base, hook_event_name: "UserPromptSubmit", prompt: SECRET_PROMPT, ...extra };
  return {
    ...base,
    hook_event_name: "Stop",
    last_assistant_message: "done",
    stop_hook_active: false,
    ...extra,
  };
}

interface Harness {
  options: ClaudeHookOptions;
  calls: Call[];
  spawns: { command: string; args: string[]; options: any; unref: number }[];
  logs: { message: string; data: unknown }[];
  out: string[];
  clock: { t: number };
}

/**
 * A fake web app. `up` says whether health answers; `onSpawn` can bring it up
 * after a number of polls. `route` answers the POST.
 */
function harness(
  input: string | null,
  config: {
    up?: boolean;
    upAfterPolls?: number;
    route?: (call: Call) => Response | Promise<Response>;
    runtime?: string | null;
    enabled?: boolean;
    basicAuth?: { username: string; password: string };
    loadSettingsThrows?: boolean;
  } = {}
): Harness {
  const calls: Call[] = [];
  const spawns: Harness["spawns"] = [];
  const logs: Harness["logs"] = [];
  const out: string[] = [];
  const clock = { t: 0 };
  const lockFiles = new Map<string, string>();
  let up = config.up ?? true;
  let pollsAfterSpawn = -1;
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    if (call.url.endsWith("/api/health")) {
      if (pollsAfterSpawn >= 0) {
        pollsAfterSpawn++;
        if (config.upAfterPolls !== undefined && pollsAfterSpawn >= config.upAfterPolls) up = true;
      }
      if (!up) throw new TypeError("fetch failed");
      return Response.json({ success: true, status: "ok" });
    }
    if (config.route) return config.route(call);
    if (call.url.endsWith("/api/claude/retrieve"))
      return Response.json({ additionalContext: "<omms-retrieval>\nmemo\n</omms-retrieval>" });
    return Response.json({ queued: true }, { status: 202 });
  };
  const options: ClaudeHookOptions = {
    stdin: stdinOf(input),
    writeStdout: (text) => out.push(text),
    fetch: fakeFetch as typeof fetch,
    spawn: ((command: string, args: string[], spawnOptions: any) => {
      const record = { command, args, options: spawnOptions, unref: 0 };
      spawns.push(record);
      pollsAfterSpawn = 0;
      return { unref: () => record.unref++, on: () => undefined };
    }) as unknown as ClaudeHookOptions["spawn"],
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    log: (message, data) => logs.push({ message, data }),
    readToken: async () => TOKEN,
    resolveRuntime: async () => (config.runtime === undefined ? "/usr/bin/node" : config.runtime),
    cliScript: "/pkg/dist/cli/index.js",
    // Keep the start lock off the real home folder.
    ensureDeps: {
      lockPath: "/fake/.omms/web-start.lock",
      lockFs: {
        createExclusive: (path, text) => {
          if (lockFiles.has(path)) return false;
          lockFiles.set(path, text);
          return true;
        },
        read: (path) => lockFiles.get(path) ?? null,
        remove: (path) => void lockFiles.delete(path),
      },
      pidAlive: () => true,
      log: () => undefined,
    },
    loadSettings: async () => {
      if (config.loadSettingsThrows) throw new Error("config broke");
      return {
        enabled: config.enabled ?? true,
        baseUrl: BASE,
        ...(config.basicAuth ? { basicAuth: config.basicAuth } : {}),
      };
    },
  };
  return { options, calls, spawns, logs, out, clock };
}

const posts = (h: Harness) => h.calls.filter((call) => call.method === "POST");
const healthCalls = (h: Harness) => h.calls.filter((call) => call.url.endsWith("/api/health"));
const logged = (h: Harness) => h.logs[0]?.data as Record<string, unknown>;

describe("readHookInput", () => {
  it("reads the whole JSON document from stdin", async () => {
    const result = await readHookInput(stdinOf('{"a":1}'), { timeoutMs: 1000, maxBytes: 100 });
    expect(result).toEqual({ text: '{"a":1}', bytes: 7 });
  });

  it("stops waiting after the input time limit when stdin never ends", async () => {
    const stream = new PassThrough();
    stream.write('{"partial":');
    const started = Date.now();
    const result = await readHookInput(stream, { timeoutMs: 40, maxBytes: 100 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.text).toBeNull();
  });

  it("stops reading as soon as the input passes the byte cap", async () => {
    const stream = new PassThrough();
    stream.write("x".repeat(200));
    const started = Date.now();
    const result = await readHookInput(stream, { timeoutMs: 5_000, maxBytes: 100 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.text).toBeNull();
  });

  it("treats input over the byte cap as no input", async () => {
    const result = await readHookInput(stdinOf("x".repeat(200)), {
      timeoutMs: 1000,
      maxBytes: 100,
    });
    expect(result.text).toBeNull();
    expect(result.bytes).toBeGreaterThan(100);
  });
});

describe("truncateContext", () => {
  it("keeps short text as it is", () => {
    expect(truncateContext("short")).toBe("short");
  });

  it("cuts long text at the limit and keeps the closing retrieval tag", () => {
    const close = `</${RETRIEVAL_TAG}>`;
    const text = `<${RETRIEVAL_TAG}>\n${"m".repeat(20_000)}\n${close}`;
    const cut = truncateContext(text);
    expect(cut.length).toBeLessThanOrEqual(CLAUDE_CONTEXT_LIMIT);
    expect(cut.length).toBeGreaterThan(CLAUDE_CONTEXT_LIMIT - 100);
    expect(cut.startsWith(`<${RETRIEVAL_TAG}>`)).toBe(true);
    expect(cut.endsWith(close)).toBe(true);
  });

  it("uses the same tag name as the shared retrieval module", () => {
    // retrieval.ts loads the store, so the hook keeps its own copy of the tag.
    const source = readFileSync(join(import.meta.dir, "../src/core/retrieval.ts"), "utf8");
    const match = source.match(/export const RETRIEVAL_SECTION_TAG = "([^"]+)"/);
    expect(match?.[1]).toBe(RETRIEVAL_TAG);
  });
});

describe("claude-hook command", () => {
  it("finds a running server, posts the prompt with the token and prints the context", async () => {
    const h = harness(JSON.stringify(payload("user-prompt-submit")));
    expect(await runClaudeHookCommand(["user-prompt-submit"], h.options)).toBe(0);
    expect(h.spawns).toHaveLength(0);
    expect(healthCalls(h)[0]?.url).toBe(`${BASE}/api/health`);
    const [post] = posts(h);
    expect(post?.url).toBe(`${BASE}/api/claude/retrieve`);
    expect(post?.headers["x-omms-token"]).toBe(TOKEN);
    expect(post?.headers["content-type"]).toContain("application/json");
    expect(post?.body).toEqual({
      event: "user-prompt-submit",
      session_id: "s-1",
      cwd: "/work/project",
      transcript_path: "/tmp/t.jsonl",
      prompt: SECRET_PROMPT,
    });
    expect(h.out).toHaveLength(1);
    expect(JSON.parse(h.out[0]!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "<omms-retrieval>\nmemo\n</omms-retrieval>",
      },
    });
    expect(logged(h)?.code).toBe("ok");
  });

  it("prints SessionStart context and sends the source", async () => {
    const h = harness(JSON.stringify(payload("session-start", { source: "compact" })));
    expect(await runClaudeHookCommand(["session-start"], h.options)).toBe(0);
    expect(posts(h)[0]?.body).toEqual({
      event: "session-start",
      session_id: "s-1",
      cwd: "/work/project",
      transcript_path: "/tmp/t.jsonl",
      source: "compact",
    });
    expect(JSON.parse(h.out[0]!).hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  it("prints nothing when the server returns empty context", async () => {
    const h = harness(JSON.stringify(payload("user-prompt-submit")), {
      route: () => Response.json({ additionalContext: "" }),
    });
    expect(await runClaudeHookCommand(["user-prompt-submit"], h.options)).toBe(0);
    expect(h.out).toEqual([]);
    expect(logged(h)?.code).toBe("ok");
  });

  it("truncates long context before printing it", async () => {
    const long = `<omms-retrieval>\n${"x".repeat(12_000)}\n</omms-retrieval>`;
    const h = harness(JSON.stringify(payload("session-start")), {
      route: () => Response.json({ additionalContext: long }),
    });
    await runClaudeHookCommand(["session-start"], h.options);
    const context = JSON.parse(h.out[0]!).hookSpecificOutput.additionalContext as string;
    expect(context.length).toBeLessThanOrEqual(CLAUDE_CONTEXT_LIMIT);
    expect(context.endsWith("</omms-retrieval>")).toBe(true);
  });

  it("posts Stop to the capture route and prints nothing", async () => {
    const h = harness(JSON.stringify(payload("stop", { stop_hook_active: true })));
    expect(await runClaudeHookCommand(["stop"], h.options)).toBe(0);
    const [post] = posts(h);
    expect(post?.url).toBe(`${BASE}/api/claude/capture`);
    expect(post?.body).toEqual({
      session_id: "s-1",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/work/project",
      last_assistant_message: "done",
      stop_hook_active: true,
    });
    expect(h.out).toEqual([]);
    expect(logged(h)?.code).toBe("ok");
  });

  it("sends Basic credentials as well when the web app has a password", async () => {
    const h = harness(JSON.stringify(payload("stop")), {
      basicAuth: { username: "me", password: "pw" },
    });
    await runClaudeHookCommand(["stop"], h.options);
    expect(posts(h)[0]?.headers.authorization).toBe(`Basic ${btoa("me:pw")}`);
    expect(posts(h)[0]?.headers["x-omms-token"]).toBe(TOKEN);
  });

  it("starts the web app detached when health fails and polls until it is up", async () => {
    const h = harness(JSON.stringify(payload("session-start")), { up: false, upAfterPolls: 3 });
    expect(await runClaudeHookCommand(["session-start"], h.options)).toBe(0);
    expect(h.spawns).toHaveLength(1);
    const [spawned] = h.spawns;
    expect(spawned?.command).toBe("/usr/bin/node");
    expect(spawned?.args).toEqual(["/pkg/dist/cli/index.js", "web"]);
    expect(spawned?.options).toMatchObject({ detached: true, stdio: "ignore" });
    expect(spawned?.unref).toBe(1);
    // Three polls after the start, one probe first, and one after the lock is taken.
    expect(healthCalls(h).length).toBe(5);
    expect(posts(h)).toHaveLength(1);
    expect(h.out).toHaveLength(1);
    expect(logged(h)).toMatchObject({ code: "ok", spawned: true });
  });

  it("gives up inside the start budget when the server never answers", async () => {
    const h = harness(JSON.stringify(payload("user-prompt-submit")), { up: false });
    expect(await runClaudeHookCommand(["user-prompt-submit"], h.options)).toBe(0);
    expect(h.spawns).toHaveLength(1);
    expect(h.clock.t).toBeLessThanOrEqual(5_000);
    expect(h.clock.t).toBeGreaterThan(4_000);
    expect(posts(h)).toHaveLength(0);
    expect(h.out).toEqual([]);
    expect(logged(h)?.code).toBe("start-timeout");
  });

  it("uses the longer start budget for Stop", async () => {
    const h = harness(JSON.stringify(payload("stop")), { up: false });
    await runClaudeHookCommand(["stop"], h.options);
    expect(h.clock.t).toBeLessThanOrEqual(30_000);
    expect(h.clock.t).toBeGreaterThan(29_000);
  });

  it("reports an unreachable server when no runtime can start it", async () => {
    const h = harness(JSON.stringify(payload("session-start")), { up: false, runtime: null });
    expect(await runClaudeHookCommand(["session-start"], h.options)).toBe(0);
    expect(h.spawns).toHaveLength(0);
    expect(logged(h)?.code).toBe("server-unreachable");
  });

  it("starts nothing when the web app is turned off", async () => {
    const h = harness(JSON.stringify(payload("session-start")), { up: false, enabled: false });
    expect(await runClaudeHookCommand(["session-start"], h.options)).toBe(0);
    expect(h.calls).toHaveLength(0);
    expect(h.spawns).toHaveLength(0);
    expect(logged(h)?.code).toBe("server-disabled");
  });

  it("exits 0 on stdin that never ends", async () => {
    const h = harness(null);
    h.options.inputTimeoutMs = 30;
    expect(await runClaudeHookCommand(["user-prompt-submit"], h.options)).toBe(0);
    expect(h.calls).toHaveLength(0);
    expect(logged(h)?.code).toBe("no-input");
  });

  const failures: [string, string, string][] = [
    ["bad JSON", "{not json", "bad-input"],
    ["missing session id", JSON.stringify({ cwd: "/x" }), "bad-input"],
    ["an empty input", "", "no-input"],
  ];
  for (const [name, input, code] of failures) {
    it(`exits 0 and logs ${code} on ${name}`, async () => {
      const h = harness(input);
      expect(await runClaudeHookCommand(["user-prompt-submit"], h.options)).toBe(0);
      expect(h.calls).toHaveLength(0);
      expect(h.out).toEqual([]);
      expect(h.logs).toHaveLength(1);
      expect(logged(h)?.code).toBe(code);
    });
  }

  const httpFailures: [string, () => Response | Promise<Response>, string][] = [
    ["HTTP 500", () => new Response("boom", { status: 500 }), "http-500"],
    ["HTTP 401", () => Response.json({ error: "Unauthorized" }, { status: 401 }), "http-401"],
    [
      "a network error",
      () => {
        throw new TypeError("fetch failed");
      },
      "network-error",
    ],
    ["a reply without context", () => Response.json({ other: 1 }), "bad-response"],
  ];
  for (const [name, route, code] of httpFailures) {
    it(`exits 0 and logs ${code} on ${name}`, async () => {
      const h = harness(JSON.stringify(payload("user-prompt-submit")), { route });
      expect(await runClaudeHookCommand(["user-prompt-submit"], h.options)).toBe(0);
      expect(h.out).toEqual([]);
      expect(h.logs).toHaveLength(1);
      expect(logged(h)?.code).toBe(code);
    });
  }

  it("aborts a request that takes longer than its budget", async () => {
    const h = harness(JSON.stringify(payload("user-prompt-submit")), {
      route: () => new Promise<Response>(() => undefined),
    });
    const fetchImpl = h.options.fetch!;
    // A request that only ends when the hook aborts it.
    h.options.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/health")) return fetchImpl(url, init);
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as typeof fetch;
    h.options.requestTimeoutMs = 30;
    expect(await runClaudeHookCommand(["user-prompt-submit"], h.options)).toBe(0);
    expect(h.out).toEqual([]);
    expect(logged(h)?.code).toBe("timeout");
  });

  it("exits 0 when a dependency throws", async () => {
    const h = harness(JSON.stringify(payload("session-start")), { loadSettingsThrows: true });
    expect(await runClaudeHookCommand(["session-start"], h.options)).toBe(0);
    expect(h.logs).toHaveLength(1);
    expect(logged(h)?.code).toBe("error");
  });

  it("exits 0 even when the logger throws", async () => {
    const h = harness(JSON.stringify(payload("session-start")));
    h.options.log = () => {
      throw new Error("disk full");
    };
    expect(await runClaudeHookCommand(["session-start"], h.options)).toBe(0);
  });

  it("exits 0 on an unknown event even when the logger throws", async () => {
    const h = harness(null);
    h.options.log = () => {
      throw new Error("disk full");
    };
    expect(await runClaudeHookCommand(["post-tool-use"], h.options)).toBe(0);
  });

  it("exits 0 and logs an unknown event without reading the input", async () => {
    const h = harness(JSON.stringify(payload("stop")));
    expect(await runClaudeHookCommand(["post-tool-use"], h.options)).toBe(0);
    expect(await runClaudeHookCommand([], h.options)).toBe(0);
    expect(h.calls).toHaveLength(0);
    expect(h.logs.map((entry) => (entry.data as any).code)).toEqual(["bad-event", "bad-event"]);
    expect(JSON.stringify(h.logs)).not.toContain("post-tool-use");
  });

  it("logs exactly one metadata line without the prompt or the context", async () => {
    const h = harness(JSON.stringify(payload("user-prompt-submit")), {
      route: () =>
        Response.json({ additionalContext: "<omms-retrieval>secret memo</omms-retrieval>" }),
    });
    await runClaudeHookCommand(["user-prompt-submit"], h.options);
    expect(h.logs).toHaveLength(1);
    const text = JSON.stringify(h.logs);
    expect(text).not.toContain(SECRET_PROMPT);
    expect(text).not.toContain("zebra-42");
    expect(text).not.toContain("secret memo");
    expect(text).not.toContain(TOKEN);
    expect(logged(h)).toMatchObject({
      event: "user-prompt-submit",
      code: "ok",
      spawned: false,
    });
    expect(typeof logged(h)?.elapsedMs).toBe("number");
    expect(logged(h)?.inputBytes).toBe(
      Buffer.byteLength(JSON.stringify(payload("user-prompt-submit")))
    );
    expect(logged(h)?.outputBytes).toBe(Buffer.byteLength(h.out[0]!));
  });
});
