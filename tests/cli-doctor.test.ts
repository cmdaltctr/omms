import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctorCommand, type DoctorCommandDeps } from "../src/cli/doctor-command.js";
import {
  changingCalls,
  scratchEnv,
  writeFakeHost,
  type FakeHost,
  type FakeHostOptions,
} from "./fake-hosts.js";
import { realHealthRows } from "./real-health-rows.js";

const TOKEN = "doctor-local-token-value";
const SECRET = "doctor-api-key-secret";
const roots: string[] = [];

type HealthRequest = { token: string | null; authorization: string | null; body: unknown };
const requests: HealthRequest[] = [];
let healthRows: unknown[] = [];
/** A non-200 status, or "hang" to never answer, for the health route. */
let healthFailure: number | "hang" | null = null;

// One stub OMMS web app, one stub of another program, and one port with nothing on it.
let omms: ReturnType<typeof Bun.serve>;
let other: ReturnType<typeof Bun.serve>;
let freePort: number;

beforeAll(() => {
  omms = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/api/health") return Response.json({ success: true, status: "ok" });
      if (path === "/api/settings/health" && req.method === "POST") {
        requests.push({
          token: req.headers.get("x-omms-token"),
          authorization: req.headers.get("authorization"),
          body: await req.json(),
        });
        if (healthFailure === "hang") return new Promise<Response>(() => {});
        if (healthFailure) {
          return Response.json({ error: `bad key ${SECRET}` }, { status: healthFailure });
        }
        return Response.json({ checks: healthRows });
      }
      return new Response("not found", { status: 404 });
    },
  });
  other = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("<html>hello</html>"),
  });
  const spare = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  freePort = spare.port!;
  spare.stop(true);
});

afterAll(() => {
  omms.stop(true);
  other.stop(true);
});

afterEach(() => {
  requests.length = 0;
  healthRows = [];
  healthFailure = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function machine(hosts: Partial<Record<FakeHost, FakeHostOptions>>) {
  const root = mkdtempSync(join(tmpdir(), "omms-cli-doctor-"));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  for (const [name, options] of Object.entries(hosts))
    writeFakeHost(bin, name as FakeHost, options);
  const env = scratchEnv(root, bin);
  mkdirSync(env.HOME!, { recursive: true });
  return { root, bin, env };
}

async function doctor(
  m: ReturnType<typeof machine>,
  argv: string[] = [],
  options: {
    port?: number;
    node?: string;
    basicAuth?: { username: string; password: string };
    healthTimeoutMs?: number;
  } = {}
) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: DoctorCommandDeps = {
    env: m.env,
    home: m.env.HOME!,
    platform: process.platform,
    nodeVersion: options.node ?? "24.1.0",
    web: () => ({
      host: "127.0.0.1",
      port: options.port ?? omms.port!,
      ...(options.basicAuth ? { basicAuth: options.basicAuth } : {}),
    }),
    ...(options.healthTimeoutMs ? { healthTimeoutMs: options.healthTimeoutMs } : {}),
    token: () => TOKEN,
    fetch,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  const code = await runDoctorCommand(argv, deps);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function doctorJson(m: ReturnType<typeof machine>, argv: string[] = [], options = {}) {
  const result = await doctor(m, ["--json", ...argv], options);
  return { ...result, rows: JSON.parse(result.out) as Array<Record<string, unknown>> };
}

const row = (rows: Array<Record<string, unknown>>, check: string) =>
  rows.find((entry) => entry.check === check);

function registerAll(m: ReturnType<typeof machine>) {
  const folder = join(m.env.XDG_CONFIG_HOME!, "opencode");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "opencode.json"), '{"plugins":["om-memory-system"]}');
  writeFileSync(join(folder, "cli.json"), '{"plugins":["om-memory-system"]}');
  mkdirSync(m.env.PI_CODING_AGENT_DIR!, { recursive: true });
  writeFileSync(
    join(m.env.PI_CODING_AGENT_DIR!, "settings.json"),
    JSON.stringify({ packages: ["npm:om-memory-system"] })
  );
  writeFileSync(join(m.bin, "claude-installed"), "yes");
}

describe("om-memory-system doctor", () => {
  it("prints only pass rows and exits 0 when everything works", async () => {
    const m = machine({
      opencode: { version: "2.1.2" },
      pi: { version: "0.86.1" },
      claude: { version: "2.1.295" },
    });
    registerAll(m);
    healthRows = [
      { check: "Embedding", status: "pass", reason: "Test text embedded" },
      {
        check: "Claude Code model",
        status: "pass",
        reason: "Resolved: external API",
        host: "claude-code",
      },
    ];
    const result = await doctorJson(m);
    expect(result.code).toBe(0);
    expect(result.rows.every((entry) => entry.status === "pass")).toBe(true);
    expect(result.rows.map((entry) => entry.check)).toEqual([
      "Node.js",
      "OpenCode version",
      "OpenCode plugin",
      "OpenCode auto-update",
      "Pi version",
      "Pi plugin",
      "Claude Code version",
      "Claude Code plugin",
      "Web app",
      "Embedding",
      "Claude Code model",
    ]);
    for (const entry of result.rows) {
      expect(Object.keys(entry).sort()).toEqual(["check", "fix", "host", "reason", "status"]);
    }
    expect(changingCalls(m.bin)).toEqual([]);
  });

  // The rows come from the real Settings health code with a default config: no host
  // model and no external API, so Pi and OpenCode use their own session model.
  const DEFAULT_SNAPSHOT = {
    effective: { "claude-code": { ready: false, issues: ["memoryModel is not configured"] } },
    claudeFolder: { root: "/scratch/.claude/projects", exists: true },
  };
  for (const [host, name] of [
    ["pi", "Pi"],
    ["opencode", "OpenCode"],
  ] as const) {
    it(`shows only pass and skipped rows for a default ${name} user, with the real health rows`, async () => {
      const m = machine({ [host]: { version: host === "pi" ? "0.86.1" : "2.1.2" } });
      registerAll(m);
      healthRows = realHealthRows({}, DEFAULT_SNAPSHOT, { testModels: true });
      const result = await doctorJson(m);
      const test = row(result.rows, `${name} model test`);
      expect(test).toMatchObject({ status: "skipped", fix: "", host });
      expect(String(test?.reason)).toContain(`a session in ${name}`);
      expect(String(test?.reason)).not.toMatch(/\ba (OpenCode|Pi|Claude Code) session/);
      const notPass = result.rows.filter((entry) => entry.status !== "pass");
      expect(notPass.map((entry) => entry.status)).toEqual(["skipped"]);
      expect(result.code).toBe(0);
    });
  }

  it("fails the Node row below the package minimum", async () => {
    const result = await doctorJson(machine({}), [], { node: "20.11.0" });
    expect(row(result.rows, "Node.js")).toMatchObject({ status: "fail", host: null });
    expect(String(row(result.rows, "Node.js")?.fix)).toContain("22.14");
    expect(result.code).toBe(1);
  });

  it("prints Pi rows only when only Pi is installed", async () => {
    const m = machine({ pi: { version: "0.86.1" } });
    registerAll(m);
    healthRows = [
      { check: "OpenCode model", status: "fail", reason: "no model", host: "opencode", fix: "x" },
      { check: "Pi model", status: "pass", reason: "Resolved: session", host: "pi" },
      {
        check: "Claude Code model",
        status: "fail",
        reason: "no api",
        host: "claude-code",
        fix: "x",
      },
      { check: "Web binding", status: "pass", reason: "safe" },
    ];
    const result = await doctorJson(m);
    const hosts = new Set(result.rows.map((entry) => entry.host));
    expect(hosts).toEqual(new Set([null, "pi"]));
    expect(row(result.rows, "Pi plugin")?.status).toBe("pass");
    expect(row(result.rows, "Web binding")?.status).toBe("pass");
    expect(result.code).toBe(0);
  });

  it("fails an old host version with the update fix", async () => {
    const m = machine({ opencode: { version: "2.0.10" } });
    const result = await doctorJson(m);
    const version = row(result.rows, "OpenCode version");
    expect(version?.status).toBe("fail");
    expect(String(version?.fix)).toContain("Update OpenCode to 2.0.22 or later");
    expect(row(result.rows, "OpenCode plugin")?.status).toBe("fail");
    expect(String(row(result.rows, "OpenCode plugin")?.fix)).toContain(
      "npx om-memory-system@latest setup"
    );
    expect(result.code).toBe(1);
  });

  it("warns when cli.json lacks the entry and gives the setup command", async () => {
    const m = machine({ opencode: { version: "2.1.2" } });
    registerAll(m);
    writeFileSync(join(m.env.XDG_CONFIG_HOME!, "opencode", "cli.json"), '{"plugins":[]}');
    const added = row((await doctorJson(m)).rows, "OpenCode auto-update");
    expect(added?.status).toBe("warn");
    expect(String(added?.fix)).toContain("npx om-memory-system@latest setup");
    rmSync(join(m.env.XDG_CONFIG_HOME!, "opencode", "cli.json"));
    const missing = row((await doctorJson(m)).rows, "OpenCode auto-update");
    expect(missing?.status).toBe("warn");
    expect(String(missing?.fix)).toContain("Start OpenCode once");
  });

  it("fetches the health rows with the local token and model tests by default", async () => {
    const m = machine({});
    await doctor(m);
    expect(requests).toEqual([{ token: TOKEN, authorization: null, body: { testModels: true } }]);
    await doctor(m, ["--skip-model-test"]);
    expect(requests[1]).toEqual({
      token: TOKEN,
      authorization: null,
      body: { testModels: false },
    });
  });

  it("fails the web app row and names the port when another program answers", async () => {
    const m = machine({ claude: { version: "2.1.295" } });
    const result = await doctorJson(m, [], { port: other.port! });
    const web = row(result.rows, "Web app");
    expect(web?.status).toBe("fail");
    expect(String(web?.reason)).toContain(String(other.port));
    expect(String(web?.reason)).toMatch(/another program/i);
    expect(String(web?.fix)).toContain("webServerPort");
    expect(row(result.rows, "Claude Code model")?.status).toBe("skipped");
    expect(requests).toEqual([]);
    expect(result.code).toBe(1);
  });

  it("skips the health rows with the start command when nothing answers", async () => {
    const m = machine({ pi: { version: "0.86.1" } });
    registerAll(m);
    const result = await doctorJson(m, [], { port: freePort });
    expect(row(result.rows, "Web app")).toMatchObject({ status: "warn" });
    expect(String(row(result.rows, "Web app")?.reason)).toContain(String(freePort));
    for (const check of ["Embedding", "Pi model"]) {
      const skipped = row(result.rows, check);
      expect(skipped?.status).toBe("skipped");
      expect(String(skipped?.fix)).toContain("npx om-memory-system@latest web");
    }
    expect(row(result.rows, "OpenCode model")).toBeUndefined();
    expect(result.code).toBe(0);
  });

  it("prints one JSON array and nothing else on standard output", async () => {
    const m = machine({ opencode: { version: "2.1.2" } });
    healthRows = [
      { check: "Embedding", status: "fail", reason: "model download failed", fix: "Open it" },
      { check: "Claude Code model test", status: "pass", reason: "Fixed prompt completed" },
    ];
    const result = await doctor(m, ["--json"]);
    expect(Array.isArray(JSON.parse(result.out))).toBe(true);
    expect(result.out.trim().startsWith("[")).toBe(true);
    expect(result.err).toContain("one short test prompt");
    expect(result.code).toBe(1);
  });

  it("prints the model test note only when a model test ran", async () => {
    const note = "one short test prompt";
    const m = machine({});
    healthRows = [];
    expect((await doctor(m)).out).not.toContain(note);
    healthRows = [
      { check: "Pi model test", status: "warn", reason: "Skipped", hostModelOnly: true },
      { check: "Embedding", status: "pass", reason: "Test text embedded" },
    ];
    const skippedOnly = await doctor(m);
    expect(`${skippedOnly.out}\n${skippedOnly.err}`).not.toContain(note);
    healthRows = [{ check: "Pi model test", status: "pass", reason: "Fixed prompt completed" }];
    expect((await doctor(m)).out).toContain(note);
    healthRows = [{ check: "Pi model test", status: "fail", reason: "401" }];
    expect((await doctor(m)).out).toContain(note);
  });

  it("prints a table with the fix for each row that is not a pass", async () => {
    const m = machine({ opencode: { version: "2.0.10" } });
    const result = await doctor(m, [], { port: freePort });
    expect(result.out).toMatch(/FAIL\s+OpenCode version/);
    expect(result.out).toContain("Fix: Update OpenCode to 2.0.22 or later");
    expect(result.out).toMatch(/PASS\s+Node\.js/);
  });

  it("sends Basic Auth to the health route when a browser password is set", async () => {
    const m = machine({});
    const basicAuth = { username: "omms", password: "doctor-browser-password" };
    const result = await doctor(m, ["--skip-model-test"], { basicAuth });
    const expected = `Basic ${Buffer.from("omms:doctor-browser-password").toString("base64")}`;
    expect(requests[0]?.authorization).toBe(expected);
    expect(`${result.out}\n${result.err}`).not.toContain("doctor-browser-password");
  });

  for (const [name, failure, words] of [
    ["refuses", 401, "refused"],
    ["fails", 500, "could not run"],
    ["takes too long", "hang", "too long"],
  ] as const) {
    it(`gives a plain reason and no start step when the running web app ${name}`, async () => {
      const m = machine({ pi: { version: "0.86.1" } });
      registerAll(m);
      healthFailure = failure;
      const result = await doctorJson(m, [], { healthTimeoutMs: 200 });
      expect(row(result.rows, "Web app")?.status).toBe("pass");
      const skipped = row(result.rows, "Pi model");
      expect(skipped?.status).toBe("skipped");
      expect(String(skipped?.reason)).toContain(words);
      expect(String(skipped?.reason)).not.toMatch(/TimeoutError|HTTP \d|AbortError/);
      expect(String(skipped?.fix)).toContain("Run checks");
      expect(String(skipped?.fix)).toContain("--skip-model-test");
      expect(String(skipped?.fix)).not.toContain("om-memory-system@latest web");
      expect(`${result.out}\n${result.err}`).not.toContain(SECRET);
    });
  }

  it("puts no API key or token in any output", async () => {
    // The secrets sit where a leak could come from: the saved config keys and the
    // error text a failing check returns. The rows come from the real health code.
    const m = machine({ claude: { version: "2.1.295" } });
    healthRows = realHealthRows(
      {
        memoryModel: "glm-5.3",
        memoryApiUrl: "https://api.invalid/v1",
        memoryApiKey: SECRET,
        embeddingApiKey: `${SECRET}-embed`,
      },
      { effective: { "claude-code": { ready: true } }, claudeFolder: { root: "/x", exists: true } },
      { embedError: `401 from https://api.invalid?key=${SECRET} with ${SECRET}-embed` }
    );
    expect(row(healthRows as Array<Record<string, unknown>>, "Embedding")?.status).toBe("fail");
    for (const argv of [[], ["--json"]]) {
      const result = await doctor(m, argv);
      expect(result.out).toContain("Embedding");
      expect(`${result.out}\n${result.err}`).not.toContain(SECRET);
      expect(`${result.out}\n${result.err}`).not.toContain(TOKEN);
    }
  });

  it("is listed with both options in the main help", () => {
    const m = machine({});
    const cli = join(import.meta.dir, "../src/cli/index.ts");
    const help = Bun.spawnSync(["bun", cli, "--help"], {
      cwd: m.root,
      env: { ...process.env, HOME: m.env.HOME!, OMMS_SKIP_LEGACY_MIGRATION: "1" },
    });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("doctor [--json] [--skip-model-test]");
  });

  it("prints help and rejects an unknown option", async () => {
    const m = machine({});
    const help = await doctor(m, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("--skip-model-test");
    expect((await doctor(m, ["--nope"])).code).toBe(1);
  });
});
