import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createStandaloneOpencodeReader,
  stopStandaloneOpencodeReads,
  type StandaloneDeps,
} from "../src/importer/opencode-standalone-models.js";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const V2_REPLY = fixture("opencode-v2-api-model.json");
const V1_REPLY = fixture("opencode-v1-provider.json");
const FAKE_KEY = "fixture-secret-key-7f3a9c";
const PASSWORD = "fake-password-9d81";
const HOME = "/home/tester";
const PROGRAM = `${HOME}/.opencode/bin/opencode`;
const SERVER = "http://127.0.0.1:43111";

type Reply = { status?: number; type?: string; body: string } | Error;

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: string[] = [];
  constructor(private readonly ignoreTerm: boolean) {
    super();
  }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.signals.push(signal);
    if (signal === "SIGTERM" && this.ignoreTerm) return true;
    queueMicrotask(() => this.exit(null, signal));
    return true;
  }
  exit(code: number | null, signal: NodeJS.Signals | null) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

/** A clock whose timers fire one at a time, earliest first, on later macrotasks. */
function fakeClock() {
  let now = 0;
  const timers: Array<{ due: number; resolve: () => void }> = [];
  let pumping = false;
  const pump = () => {
    pumping = false;
    timers.sort((a, b) => a.due - b.due);
    const next = timers.shift();
    if (!next) return;
    now = Math.max(now, next.due);
    next.resolve();
    schedule();
  };
  const schedule = () => {
    if (pumping || timers.length === 0) return;
    pumping = true;
    setTimeout(pump, 0);
  };
  return {
    now: () => now,
    set: (value: number) => {
      now = value;
    },
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push({ due: now + ms, resolve });
        schedule();
      }),
  };
}

interface HarnessOptions {
  files?: string[];
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  startLine?: string | null;
  exitBeforeListening?: boolean;
  ignoreTerm?: boolean;
  replies?: Record<string, Reply[]>;
}

function harness(options: HarnessOptions = {}) {
  const clock = fakeClock();
  const children: FakeChild[] = [];
  const spawns: Array<{ command: string; args: string[]; options: Record<string, any> }> = [];
  const requests: Array<{ url: string; headers: Record<string, string>; at: number }> = [];
  const logs: unknown[] = [];
  const files = new Set(options.files ?? [PROGRAM]);
  const replies = options.replies ?? { "/api/model": [{ body: V2_REPLY }] };
  const served = new Map<string, number>();
  const deps: StandaloneDeps = {
    spawn: (command, args, spawnOptions) => {
      spawns.push({ command, args, options: spawnOptions as Record<string, any> });
      const child = new FakeChild(options.ignoreTerm ?? false);
      children.push(child);
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(`starting with password ${PASSWORD}\n`));
        if (options.exitBeforeListening) return child.exit(1, null);
        const line =
          options.startLine === undefined ? `server listening on ${SERVER}\n` : options.startLine;
        if (line) child.stderr.emit("data", Buffer.from(line));
      });
      return child;
    },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      requests.push({ url, headers: init.headers, at: clock.now() });
      const list = replies[path] ?? [{ status: 404, type: "text/plain", body: "Not Found" }];
      const index = served.get(path) ?? 0;
      served.set(path, index + 1);
      const reply = list[Math.min(index, list.length - 1)];
      if (reply instanceof Error) throw reply;
      return new Response(reply.body, {
        status: reply.status ?? 200,
        headers: { "content-type": reply.type ?? "application/json" },
      });
    },
    now: clock.now,
    sleep: clock.sleep,
    isFile: (path) => files.has(path),
    kill: (child, signal) => {
      child.kill(signal);
    },
    env: options.env ?? { PATH: "/usr/bin:/bin" },
    platform: options.platform ?? "darwin",
    home: HOME,
    password: () => PASSWORD,
    log: (message, data) => {
      logs.push({ message, data });
    },
  };
  return { deps, clock, children, spawns, requests, logs };
}

const v2 = (records: unknown[]) => ({ body: JSON.stringify({ location: {}, data: records }) });
const record = (providerID: string, id: string, name = id) => ({
  id,
  modelID: id,
  providerID,
  name,
  settings: { apiKey: FAKE_KEY },
});

describe("standalone OpenCode model list", () => {
  it("maps the v2 list to provider, model, and name", async () => {
    const { deps, requests } = harness();
    const result = await createStandaloneOpencodeReader(deps)();
    expect(result).toEqual({
      outcome: "listed",
      models: [
        { provider: "zai-coding-plan", model: "glm-5.3", name: "GLM-5.3" },
        { provider: "zai-coding-plan", model: "glm-5.3-flash", name: "GLM-5.3-Flash" },
        { provider: "openai", model: "gpt-6-luna-fast", name: "gpt-6-luna-fast" },
      ],
    });
    expect(requests[0].url).toBe(`${SERVER}/api/model`);
  });

  it("falls back to the v1 route when /api/model returns 404", async () => {
    const { deps, requests } = harness({
      replies: {
        "/api/model": [{ status: 404, type: "text/plain", body: "Not Found" }],
        "/provider": [{ body: V1_REPLY }],
      },
    });
    const result = await createStandaloneOpencodeReader(deps)();
    expect(result).toEqual({
      outcome: "listed",
      models: [
        { provider: "zai-coding-plan", model: "glm-5.3", name: "GLM-5.3" },
        { provider: "zai-coding-plan", model: "glm-5.3-flash", name: "GLM-5.3-Flash" },
      ],
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toContain("/provider");
  });

  it("falls back to the v1 route when /api/model returns HTML", async () => {
    const { deps } = harness({
      replies: {
        "/api/model": [{ type: "text/html", body: "<!doctype html><html></html>" }],
        "/provider": [{ body: V1_REPLY }],
      },
    });
    const result = await createStandaloneOpencodeReader(deps)();
    expect(result.outcome).toBe("listed");
  });

  it("polls until two replies in a row have the same non-empty count", async () => {
    const partial = [record("zai-coding-plan", "glm-5.3")];
    const full = [...partial, record("openai", "gpt-6-luna"), record("openai", "gpt-6-sol")];
    const { deps, requests } = harness({
      replies: { "/api/model": [v2([]), v2(partial), v2(full), v2(full)] },
    });
    const result = await createStandaloneOpencodeReader(deps)();
    expect(result.outcome === "listed" && result.models.length).toBe(3);
    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.at)).toEqual([0, 250, 500, 750]);
  });

  it("uses a still-growing list at the 5 second limit", async () => {
    let count = 0;
    const { deps } = harness();
    deps.fetch = async () => {
      count += 1;
      const records = Array.from({ length: count }, (_, i) => record("zai", `m${i}`));
      return new Response(JSON.stringify({ data: records }), {
        headers: { "content-type": "application/json" },
      });
    };
    const result = await createStandaloneOpencodeReader(deps)();
    expect(result.outcome === "listed" && result.models.length).toBe(count);
    expect(count).toBeGreaterThan(15);
  });

  it("reports no signed-in models when the list is still empty at 5 seconds", async () => {
    const { deps, requests, clock } = harness({ replies: { "/api/model": [v2([])] } });
    const result = await createStandaloneOpencodeReader(deps)();
    expect(result).toEqual({ outcome: "empty" });
    expect(requests.length).toBeGreaterThan(15);
    expect(clock.now()).toBeGreaterThanOrEqual(5000);
  });

  it("reports took too long when no start line comes in 10 seconds", async () => {
    const { deps, requests, clock } = harness({ startLine: null });
    const result = await createStandaloneOpencodeReader(deps)();
    expect(result).toEqual({ outcome: "start_timeout" });
    expect(requests).toHaveLength(0);
    expect(clock.now()).toBeGreaterThanOrEqual(10_000);
  });

  it("reports took too long when OpenCode exits before it listens", async () => {
    const { deps, clock } = harness({ exitBeforeListening: true });
    expect(await createStandaloneOpencodeReader(deps)()).toEqual({ outcome: "start_timeout" });
    // The exit ends the wait at once, without waiting for the 10 second limit.
    expect(clock.now()).toBe(0);
  });

  it("reports took too long when no reply comes in 5 seconds", async () => {
    const { deps } = harness({ replies: { "/api/model": [new Error("connection refused")] } });
    expect(await createStandaloneOpencodeReader(deps)()).toEqual({ outcome: "start_timeout" });
  });

  it("reports cannot read for an unknown reply shape", async () => {
    const { deps } = harness({ replies: { "/api/model": [{ body: '{"models":{}}' }] } });
    expect(await createStandaloneOpencodeReader(deps)()).toEqual({ outcome: "unreadable" });
    const v1 = harness({
      replies: {
        "/api/model": [{ status: 404, body: "" }],
        "/provider": [{ body: '{"providers":[]}' }],
      },
    });
    expect(await createStandaloneOpencodeReader(v1.deps)()).toEqual({ outcome: "unreadable" });
    const badRecord = harness({ replies: { "/api/model": [v2([{ id: 7 }])] } });
    expect(await createStandaloneOpencodeReader(badRecord.deps)()).toEqual({
      outcome: "unreadable",
    });
  });

  it("starts nothing when the program is not found", async () => {
    const { deps, spawns, logs } = harness({ files: [] });
    expect(await createStandaloneOpencodeReader(deps)()).toEqual({ outcome: "not_found" });
    expect(spawns).toHaveLength(0);
    expect(logs).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ outcome: "not_found" }) }),
    ]);
  });

  it("starts a loopback server with its own password in the home folder", async () => {
    const { deps, spawns, requests } = harness();
    await createStandaloneOpencodeReader(deps)();
    expect(spawns).toHaveLength(1);
    expect(spawns[0].command).toBe(PROGRAM);
    expect(spawns[0].args).toEqual(["serve", "--hostname=127.0.0.1", "--port=0"]);
    expect(spawns[0].options.cwd).toBe(HOME);
    expect(spawns[0].options.env.OPENCODE_SERVER_PASSWORD).toBe(PASSWORD);
    expect(JSON.stringify(spawns[0].args)).not.toContain(PASSWORD);
    const auth = `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`;
    expect(requests.every((request) => request.headers.authorization === auth)).toBe(true);
    expect(requests.every((request) => !request.url.includes(PASSWORD))).toBe(true);
  });
});

describe("standalone OpenCode secrets and shutdown", () => {
  const paths: Array<[string, HarnessOptions]> = [
    ["listed", {}],
    ["empty", { replies: { "/api/model": [v2([])] } }],
    ["start_timeout", { startLine: null }],
    ["unreadable", { replies: { "/api/model": [{ body: "{}" }] } }],
    [
      "fetch error",
      {
        replies: {
          "/api/model": [new Error(`refused ${PASSWORD} ${FAKE_KEY} ${SERVER}`)],
        },
      },
    ],
  ];

  for (const [name, options] of paths) {
    it(`keeps the key and password out and stops the child: ${name}`, async () => {
      const { deps, children, logs } = harness(options);
      const result = await createStandaloneOpencodeReader(deps)();
      await stopStandaloneOpencodeReads();
      const seen = JSON.stringify(result) + JSON.stringify(logs);
      expect(seen).not.toContain(FAKE_KEY);
      expect(seen).not.toContain(PASSWORD);
      expect(children).toHaveLength(1);
      expect(children[0].signals[0]).toBe("SIGTERM");
      expect(children[0].signalCode).toBe("SIGTERM");
      expect(logs).toHaveLength(1);
    });
  }

  it("keeps the key and password out when fetch itself throws a secret", async () => {
    const { deps, logs } = harness();
    deps.fetch = async () => {
      throw new Error(`bad ${PASSWORD} ${FAKE_KEY}`);
    };
    const result = await createStandaloneOpencodeReader(deps)();
    expect(JSON.stringify(result) + JSON.stringify(logs)).not.toMatch(
      /fake-password|fixture-secret/
    );
  });

  it("logs one record with the outcome, count, and times", async () => {
    const { deps, logs } = harness();
    await createStandaloneOpencodeReader(deps)();
    expect(logs).toEqual([
      {
        message: "OpenCode standalone model list",
        data: { outcome: "listed", count: 3, startMs: 0, listMs: 250 },
      },
    ]);
  });

  it("returns the list before the stop finishes, then sends SIGKILL 5 seconds after an ignored SIGTERM", async () => {
    const { deps, children, clock } = harness({ ignoreTerm: true });
    const result = await createStandaloneOpencodeReader(deps)();
    expect(result.outcome).toBe("listed");
    const listedAt = clock.now();
    expect(children[0].signals).toEqual(["SIGTERM"]);
    await stopStandaloneOpencodeReads();
    expect(children[0].signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(children[0].signalCode).toBe("SIGKILL");
    expect(clock.now() - listedAt).toBeGreaterThanOrEqual(5000);
  });
});

describe("finding the opencode program", () => {
  it("prefers the installer folder, then PATH, then the fixed folders", async () => {
    const onPath = "/usr/bin/opencode";
    const fixed = [
      "/opt/homebrew/bin/opencode",
      "/usr/local/bin/opencode",
      `${HOME}/.bun/bin/opencode`,
    ];
    const cases: Array<[string[], string]> = [
      [[PROGRAM, onPath, ...fixed], PROGRAM],
      [[onPath, ...fixed], onPath],
      [fixed, fixed[0]],
      [fixed.slice(1), fixed[1]],
      [fixed.slice(2), fixed[2]],
    ];
    for (const [files, expected] of cases) {
      const { deps, spawns } = harness({ files });
      await createStandaloneOpencodeReader(deps)();
      expect(spawns[0]?.command).toBe(expected);
    }
  });

  it("follows the order of the folders on PATH", async () => {
    const { deps, spawns } = harness({
      files: ["/second/opencode", "/first/opencode"],
      env: { PATH: "/first:/second" },
    });
    await createStandaloneOpencodeReader(deps)();
    expect(spawns[0].command).toBe("/first/opencode");
  });

  it("uses PATHEXT on Windows and runs .exe files directly", async () => {
    const home = "C:\\Users\\tester";
    const { deps, spawns } = harness({
      platform: "win32",
      files: ["C:\\npm\\opencode.CMD", "C:\\npm\\opencode.EXE"],
      env: { Path: "C:\\tools;C:\\npm", PATHEXT: ".EXE;.CMD" },
    });
    deps.home = home;
    await createStandaloneOpencodeReader(deps)();
    expect(spawns[0].command).toBe("C:\\npm\\opencode.EXE");
    expect(spawns[0].args).toEqual(["serve", "--hostname=127.0.0.1", "--port=0"]);
    expect(spawns[0].options.windowsHide).toBe(true);
  });

  it("checks the installer folder first on Windows", async () => {
    const { deps, spawns } = harness({
      platform: "win32",
      files: ["C:\\Users\\tester\\.opencode\\bin\\opencode.exe", "C:\\npm\\opencode.exe"],
      env: { PATH: "C:\\npm" },
    });
    deps.home = "C:\\Users\\tester";
    await createStandaloneOpencodeReader(deps)();
    expect(spawns[0].command).toBe("C:\\Users\\tester\\.opencode\\bin\\opencode.exe");
  });

  it("starts .cmd files through cmd.exe on Windows", async () => {
    const { deps, spawns } = harness({
      platform: "win32",
      files: ["C:\\Program Files\\nodejs\\opencode.CMD"],
      env: {
        PATH: "C:\\Program Files\\nodejs",
        PATHEXT: ".EXE;.CMD",
        ComSpec: "C:\\Windows\\system32\\cmd.exe",
      },
    });
    deps.home = "C:\\Users\\tester";
    await createStandaloneOpencodeReader(deps)();
    expect(spawns[0].command).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(spawns[0].args).toEqual([
      "/d",
      "/s",
      "/c",
      '""C:\\Program Files\\nodejs\\opencode.CMD" serve --hostname=127.0.0.1 --port=0"',
    ]);
    expect(spawns[0].options.windowsVerbatimArguments).toBe(true);
  });
});

describe("sharing and keeping the list", () => {
  it("starts one child for two reads at the same time", async () => {
    const { deps, spawns } = harness();
    const read = createStandaloneOpencodeReader(deps);
    const [first, second] = await Promise.all([read(), read()]);
    expect(spawns).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("reuses a listed result for 5 minutes", async () => {
    const { deps, spawns, clock } = harness();
    const read = createStandaloneOpencodeReader(deps);
    await read();
    const listedAt = clock.now();
    clock.set(listedAt + 5 * 60_000 - 1);
    await read();
    expect(spawns).toHaveLength(1);
    clock.set(listedAt + 5 * 60_000 + 1);
    await read();
    expect(spawns).toHaveLength(2);
  });

  it("reuses a failed result for 30 seconds", async () => {
    const { deps, spawns, clock } = harness({ exitBeforeListening: true });
    const read = createStandaloneOpencodeReader(deps);
    expect((await read()).outcome).toBe("start_timeout");
    const failedAt = clock.now();
    clock.set(failedAt + 30_000 - 1);
    await read();
    expect(spawns).toHaveLength(1);
    clock.set(failedAt + 30_000 + 1);
    await read();
    expect(spawns).toHaveLength(2);
  });
});
