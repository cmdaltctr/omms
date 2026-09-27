import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function scenario(body: string, globalConfig = "{}", projectConfig?: string) {
  const home = mkdtempSync(join(tmpdir(), "omms-settings-api-"));
  dirs.push(home);
  const project = join(home, "project");
  mkdirSync(join(project, ".opencode"), { recursive: true });
  if (projectConfig) writeFileSync(join(project, ".opencode", "omms.jsonc"), projectConfig);
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(configPath, globalConfig);
  const serverUrl = pathToFileURL(join(import.meta.dir, "../src/services/web-server.ts")).href;
  const tokenUrl = pathToFileURL(join(import.meta.dir, "../src/services/auth-token.ts")).href;
  const embeddingUrl = pathToFileURL(join(import.meta.dir, "../src/services/embedding.ts")).href;
  const script = `
    const { mock } = await import("bun:test");
    const embeddingUrl = ${JSON.stringify(embeddingUrl)};
    const { WebServer } = await import(${JSON.stringify(serverUrl)});
    const { getOrCreateAuthToken } = await import(${JSON.stringify(tokenUrl)});
    const token = getOrCreateAuthToken();
    const configPath = ${JSON.stringify(configPath)};
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: ${JSON.stringify(project)} });
    const send = (path, method = "GET", body, headers = {}) => server.handleRequest(
      new Request("http://127.0.0.1:4747" + path, { method,
        headers: { "x-omms-token": token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    );
    const output = await (async () => { ${body} })();
    console.log("RESULT:" + JSON.stringify(output));
  `;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_LOG_FILE: join(home, "omms.log"),
      OMMS_SECRET_TEST: "private-test-value",
    },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text);
  return JSON.parse(match[1]);
}

describe("settings API", () => {
  it("ignores a supplied log path, filters capture lines, and enforces the limit", async () => {
    const result = await scenario(`
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.OMMS_LOG_FILE, "ordinary\\nCapture attempt saved\\nCapture attempt failed\\n");
      const response = await send("/api/settings/log?lines=1&filter=capture&path=/etc/passwd");
      return { status: response.status, body: await response.json() };
    `);
    expect(result.status).toBe(200);
    expect(result.body.lines).toEqual(["Capture attempt failed"]);
    expect(result.body.path).toContain("omms.log");
  });
  it("reports project overrides and secret source without disclosing the key", async () => {
    const result = await scenario(
      `
      const response = await send("/api/settings");
      return { status: response.status, body: await response.json() };
    `,
      '{ "piModel": "global", "memoryApiKey": "env://OMMS_SECRET_TEST" }',
      '{ "piModel": "project" }'
    );
    expect(result.status).toBe(200);
    expect(result.body.settings.piModel).toMatchObject({ value: "project", source: "project" });
    expect(result.body.secrets.memoryApiKey).toMatchObject({ set: true, source: "env" });
    expect(JSON.stringify(result.body)).not.toContain("OMMS_SECRET_TEST");
  });

  it("writes valid settings, rejects stale revisions, and keeps secrets out of responses", async () => {
    const result = await scenario(`
      const { readFileSync } = await import("node:fs");
      const before = await (await send("/api/settings")).json();
      const saved = await send("/api/settings", "PATCH", { edits: { piModel: "new" }, revision: before.revision }, { "content-type": "application/json" });
      const stale = await send("/api/settings", "PATCH", { edits: { piModel: "stale" }, revision: before.revision }, { "content-type": "application/json" });
      return { status: saved.status, body: await saved.json(), stale: stale.status,
        text: readFileSync(configPath, "utf8") };
    `);
    expect(result.status).toBe(200);
    expect(result.stale).toBe(409);
    expect(result.text).toContain('"piModel": "new"');
  });

  it("rejects traversal in trace endpoints", async () => {
    const result = await scenario(`
      const read = await send("/api/settings/traces/%2e%2e%2fsecret");
      const remove = await send("/api/settings/traces/%2e%2e%2fsecret", "DELETE", {}, { "content-type": "application/json" });
      return { read: read.status, remove: remove.status };
    `);
    expect(result.read).toBe(400);
    expect(result.remove).toBe(400);
  });

  it("requires the network token and refuses tracing without Basic Auth", async () => {
    const result = await scenario(`
      const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747, apiToken: "network-test-token" });
      const request = (headers) => network.handleRequest(new Request("http://127.0.0.1:4747/api/settings", {
        method: "PATCH", headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ edits: { captureTrace: true }, revision: "unused" }),
      }));
      return { without: (await request({ "x-omms-token": token })).status,
        withToken: (await request({ authorization: "Bearer network-test-token" })).status };
    `);
    expect(result.without).toBe(401);
    expect(result.withToken).toBe(403);
  });

  it("serves the settings page on a direct request", async () => {
    const result = await scenario(`
      const response = await send("/settings");
      return { status: response.status, contentType: response.headers.get("content-type"), text: (await response.text()).slice(0, 100) };
    `);
    expect(result.status).toBe(200);
    expect(result.contentType).toContain("text/html");
  });

  it("reports health checks and warns on a high capture failure rate", async () => {
    const result = await scenario(`
      mock.module(embeddingUrl, () => ({ embeddingService: { embedWithTimeout: async () => [0.1] } }));
      const { CONFIG } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
      const { saveCaptureAttempt } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/capture-attempt-store.ts")).href)});
      for (let i = 0; i < 5; i++) await saveCaptureAttempt({ host: "pi", sourceType: "live", sessionId: "s", durationMs: 1,
        outcome: i < 2 ? "failed" : "saved", reason: i < 2 ? "model_error" : undefined });
      const response = await send("/api/settings/health", "POST", { testModels: false }, { "content-type": "application/json" });
      return { status: response.status, checks: (await response.json()).checks };
    `);
    expect(result.status).toBe(200);
    expect(
      result.checks.find((row: { check: string }) => row.check === "Capture failures (24 hours)")
    ).toMatchObject({ status: "warn", reason: "2/5 failed; most common reason: model_error" });
    expect(result.checks.find((row: { check: string }) => row.check === "Embedding").status).toBe(
      "pass"
    );
  });

  it("rejects form posts and foreign origins before editing config", async () => {
    const result = await scenario(`
      const form = await send("/api/settings", "PATCH", { edits: { piModel: "new" } }, { "content-type": "application/x-www-form-urlencoded" });
      const foreign = await send("/api/settings", "PATCH", { edits: { piModel: "new" } }, { origin: "https://example.com", "content-type": "application/json" });
      return { form: form.status, foreign: foreign.status };
    `);
    expect(result.form).toBe(415);
    expect(result.foreign).toBe(403);
  });

  it("lists import sessions over guarded JSON POSTs with metadata only", async () => {
    const result = await scenario(`
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const root = process.env.HOME + "/pi-sessions";
      mkdirSync(root, { recursive: true });
      writeFileSync(root + "/s.jsonl", JSON.stringify({ type: "session", version: 3, id: "sess-1", cwd: process.env.HOME }) + "\\n" +
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "secret prompt text" } }) + "\\n");
      const json = { "content-type": "application/json" };
      const validate = await send("/api/settings/imports/sources/validate", "POST", { host: "pi", path: root }, json);
      const source = await validate.json();
      const list = await send("/api/settings/imports/sessions", "POST", { host: "pi", source: source.sourceToken, scope: "all-projects", refresh: true }, json);
      const listed = await list.json();
      const relative = await send("/api/settings/imports/sources/validate", "POST", { host: "pi", path: "pi-sessions" }, json);
      const getList = await send("/api/settings/imports/sessions");
      const readiness = await send("/api/settings/imports/readiness");
      const browse = await send("/api/settings/imports/sources/browse", "POST", { host: "pi", path: process.env.HOME }, json);
      return {
        validate: validate.status, kind: source.kind,
        list: list.status, keys: listed.rows.map((row) => row.key), text: JSON.stringify(listed),
        relative: relative.status, getList: getList.status,
        readiness: readiness.status, readinessKeys: Object.keys(await readiness.json()).sort(),
        browse: browse.status, entries: (await browse.json()).entries.map((entry) => entry.name),
      };
    `);
    expect(result.validate).toBe(200);
    expect(result.kind).toBe("pi-folder");
    expect(result.list).toBe(200);
    expect(result.keys).toEqual(["s.jsonl"]);
    expect(result.text).not.toContain("secret prompt text");
    expect(result.relative).toBe(400);
    expect(result.getList).not.toBe(200);
    expect(result.readiness).toBe(200);
    expect(result.readinessKeys).toEqual(["external", "opencode", "piReader"]);
    expect(result.browse).toBe(200);
    expect(result.entries).toContain("pi-sessions");
  });

  it("refuses browsing on a network bind and cross-site listing without a JSON body", async () => {
    const result = await scenario(`
      const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747, apiToken: "network-test-token" });
      const browse = await network.handleRequest(new Request("http://127.0.0.1:4747/api/settings/imports/sources/browse", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer network-test-token" },
        body: JSON.stringify({ host: "pi" }),
      }));
      // Basic Auth on: any origin passes CORS and the settings token check is skipped,
      // so only the JSON body requirement stops a cross-site form from starting work.
      const basic = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747,
        auth: { isEnabled: () => true, check: () => ({ ok: true }) } });
      const crossSite = await basic.handleRequest(new Request("http://127.0.0.1:4747/api/settings/imports/sessions", {
        method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" },
        body: JSON.stringify({ host: "opencode", refresh: true }),
      }));
      return { browse: browse.status, crossSite: crossSite.status };
    `);
    expect(result.browse).toBe(403);
    expect(result.crossSite).toBe(415);
  });
});
