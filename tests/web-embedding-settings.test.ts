import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const src = (path: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dir, "../src", path)).href);

/** Run a web app in its own process with a temporary home and a fake embeddings server. */
async function scenario(body: string) {
  const home = mkdtempSync(join(tmpdir(), "omms-embedding-api-"));
  dirs.push(home);
  const project = join(home, "project");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(join(home, ".config", "omms", "omms.jsonc"), "{}");
  const script = `
    const { WebServer } = await import(${src("services/web-server.ts")});
    const { getOrCreateAuthToken } = await import(${src("services/auth-token.ts")});
    const { CONFIG, initConfig } = await import(${src("config.ts")});
    initConfig(${JSON.stringify(project)});
    const token = getOrCreateAuthToken();
    const fake = { failOn: null, calls: 0 };
    const embedder = Bun.serve({ port: 0, async fetch(request) {
      const body = await request.json();
      fake.calls++;
      if (body.model !== "fake-model") return Response.json({ error: "model not found" }, { status: 404, statusText: "Not Found" });
      if (fake.failOn && String(body.input).includes(fake.failOn)) return new Response("down", { status: 503 });
      return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    } });
    const embedUrl = "http://127.0.0.1:" + embedder.port + "/v1";
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: ${JSON.stringify(project)} });
    const send = (path, method = "GET", body, { address = "127.0.0.1", headers = {} } = {}) => server.handleRequest(
      new Request("http://127.0.0.1:4747" + path, { method,
        headers: { "x-omms-token": token, "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) }),
      address
    );
    const revision = async () => (await (await send("/api/settings")).json()).revision;
    const waitForRun = async () => {
      for (let i = 0; i < 200; i++) {
        const run = await (await send("/api/settings/embedding/run")).json();
        if (run.state !== "running") return run;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("run did not finish");
    };
    const addMemories = async (scope, hash, contents) => {
      const { tursoShardManager } = await import(${src("services/turso/shard-manager.ts")});
      const { tursoConnectionManager } = await import(${src("services/turso/connection-manager.ts")});
      const { tursoVectorSearch } = await import(${src("services/turso/vector-search.ts")});
      const shard = await tursoShardManager.createShard(scope, hash, 0);
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      for (const [index, content] of contents.entries()) {
        const vector = new Float32Array(CONFIG.embeddingDimensions).fill(0.01);
        await tursoVectorSearch.insertVector(db, { id: scope + index, content, vector, tagsVector: vector,
          containerTag: "opencode_" + scope + "_" + hash, tags: "", type: scope, createdAt: 1, updatedAt: 1,
          metadata: "{}", displayName: content, projectPath: "/p" });
        await tursoShardManager.incrementVectorCount(shard.id);
      }
    };
    try {
      const output = await (async () => { ${body} })();
      console.log("RESULT:" + JSON.stringify(output));
    } finally {
      embedder.stop(true);
    }
  `;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_LOG_FILE: join(home, "omms.log"),
      EMBED_TEST_KEY: "embed-secret-value",
    },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text + error);
  return { result: JSON.parse(match[1]), home };
}

it("tests a candidate embedder without changing the shared one", async () => {
  const { result } = await scenario(`
    const { embeddingService } = await import(${src("services/embedding.ts")});
    const before = CONFIG.embeddingModel;
    const pass = await (await send("/api/settings/embedding/test", "POST",
      { kind: "server", url: embedUrl, model: "fake-model", key: { source: "none" } })).json();
    const fail = await (await send("/api/settings/embedding/test", "POST",
      { kind: "server", url: embedUrl, model: "unknown-model", key: { source: "env", name: "EMBED_TEST_KEY" } })).json();
    return { pass, fail, model: CONFIG.embeddingModel, same: before === CONFIG.embeddingModel,
      warm: embeddingService.isWarmedUp };
  `);
  expect(result.pass).toEqual({ ok: true, dimensions: 3 });
  expect(result.fail.ok).toBe(false);
  expect(result.fail.reason).toContain("404");
  expect(JSON.stringify(result.fail)).not.toContain("embed-secret-value");
  expect(result.same).toBe(true);
  expect(result.warm).toBe(false);
}, 30000);

it("applies only a tested embedder, from this machine, one run at a time", async () => {
  const { result } = await scenario(`
    await addMemories("user", "aaaaaaaaaaaaaaaa", ["first memory"]);
    await addMemories("project", "bbbbbbbbbbbbbbbb", ["second memory", "fail-me memory"]);
    const candidate = { kind: "server", url: embedUrl, model: "fake-model", key: { source: "none" } };
    const untested = await send("/api/settings/embedding/apply", "POST", { candidate, revision: await revision() });
    await send("/api/settings/embedding/test", "POST", candidate);
    const remote = await send("/api/settings/embedding/apply", "POST", { candidate, revision: await revision() }, { address: "192.168.1.5" });
    fake.failOn = "fail-me";
    const applied = await send("/api/settings/embedding/apply", "POST", { candidate, revision: await revision() });
    const second = await send("/api/settings/embedding/apply", "POST", { candidate, revision: await revision() });
    const failed = await waitForRun();
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const config = readFileSync(join(process.env.HOME, ".config", "omms", "omms.jsonc"), "utf8");
    fake.failOn = null;
    const retry = await send("/api/settings/embedding/run", "POST", {});
    const done = await waitForRun();
    const { migrationService } = await import(${src("services/migration-service.ts")});
    const after = await migrationService.detectDimensionMismatch();
    return { untested: untested.status, remote: remote.status, applied: applied.status,
      second: second.status, failed, retry: retry.status, done, config: JSON.parse(config),
      needsMigration: after.needsMigration };
  `);
  expect(result.untested).toBe(409);
  expect(result.remote).toBe(403);
  expect(result.applied).toBe(202);
  expect(result.second).toBe(409);
  expect(result.failed.state).toBe("failed");
  expect(result.failed.error).toContain("503");
  expect(result.config).toMatchObject({
    embeddingModel: "fake-model",
    embeddingDimensions: 3,
  });
  expect(result.config.embeddingApiUrl).toContain("127.0.0.1");
  expect(result.config.embeddingApiKey).toBeUndefined();
  expect(result.retry).toBe(202);
  expect(result.done.state).toBe("done");
  // The user shard finished in the first run; the retry redoes only the project shard.
  expect(result.done.progress.total).toBe(2);
  expect(result.needsMigration).toBe(false);
}, 30000);

it("refuses Apply when the key behind a tested source has changed", async () => {
  const { result } = await scenario(`
    const candidate = { kind: "server", url: embedUrl, model: "fake-model", key: { source: "env", name: "EMBED_TEST_KEY" } };
    await send("/api/settings/embedding/test", "POST", candidate);
    process.env.EMBED_TEST_KEY = "a-different-key";
    const changed = await send("/api/settings/embedding/apply", "POST", { candidate, revision: await revision() });
    return { changed: changed.status, body: await changed.text() };
  `);
  expect(result.changed).toBe(409);
  expect(result.body).not.toContain("a-different-key");
}, 30000);
