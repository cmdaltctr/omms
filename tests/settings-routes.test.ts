import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The Settings routes of friendly-settings (group 4): the cleanup preview, the
 * key route for both keys, and the External API test with the form's values.
 * Each case runs in a child process with a scratch HOME and a WebServer that
 * never starts, so requests pass the same origin and token checks as the page.
 */
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const src = (path: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dir, "../src", path)).href);

async function scenario(body: string, globalConfig = "{}") {
  const home = mkdtempSync(join(tmpdir(), "omms-settings-routes-"));
  dirs.push(home);
  const project = join(home, "project");
  mkdirSync(project, { recursive: true });
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(configPath, globalConfig);
  const script = `
    const { readFileSync, existsSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { WebServer } = await import(${src("services/web-server.ts")});
    const { getOrCreateAuthToken } = await import(${src("services/auth-token.ts")});
    const token = getOrCreateAuthToken();
    const configPath = ${JSON.stringify(configPath)};
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: ${JSON.stringify(project)} });
    const send = async (path, method = "GET", body, headers = { "x-omms-token": token }) => {
      const response = await server.handleRequest(new Request("http://127.0.0.1:4747" + path, {
        method, headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) }));
      const text = await response.text();
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      return { status: response.status, body: parsed, text };
    };
    const settings = async () => (await send("/api/settings")).body;
    const readLog = () => existsSync(process.env.OMMS_LOG_FILE) ? readFileSync(process.env.OMMS_LOG_FILE, "utf8") : "";
    const output = await (async () => { ${body} })();
    console.log("RESULT:" + JSON.stringify(output));
    process.exit(0);
  `;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_LOG_FILE: join(home, "omms.log") },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text + error);
  return JSON.parse(match[1]!);
}

describe("cleanup preview route", () => {
  it("counts old unpinned memories for the given days, refuses bad days, and deletes nothing", async () => {
    const result = await scenario(`
      const { CONFIG } = await import(${src("config.ts")});
      const { closeTursoAndInvalidateCaches } = await import(${src("services/turso/lifecycle.ts")});
      const { tursoShardManager } = await import(${src("services/turso/shard-manager.ts")});
      const { tursoConnectionManager } = await import(${src("services/turso/connection-manager.ts")});
      const { tursoVectorSearch } = await import(${src("services/turso/vector-search.ts")});
      const { userPromptManager } = await import(${src("services/user-prompt/user-prompt-manager.ts")});
      CONFIG.storagePath = join(process.env.HOME, "store");
      CONFIG.embeddingDimensions = 8;
      await closeTursoAndInvalidateCaches();
      const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
      const shard = await tursoShardManager.createShard("project", "a1b2c3d4e5f60718", 0);
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const vector = new Float32Array(8); vector[0] = 1;
      const ids = ["old-1", "old-2", "old-3", "pinned-1", "linked-1", "new-1"];
      for (const id of ids) {
        const at = id === "new-1" ? Date.now() : old;
        await tursoVectorSearch.insertVector(db, { id, content: id, vector,
          containerTag: "omms_project_a1b2c3d4e5f60718", type: "discussion", createdAt: at, updatedAt: at });
      }
      await tursoVectorSearch.pinMemory(db, "pinned-1");
      const promptId = await userPromptManager.savePrompt("s1", "m1", "/work", "prompt");
      await userPromptManager.linkMemoryToPrompt(promptId, "linked-1");
      const prompts = await tursoConnectionManager.getConnection(join(CONFIG.storagePath, "user-prompts.db"));
      await prompts.run("UPDATE user_prompts SET created_at = ?", [old]);
      const count = async () => Number((await db.get("SELECT COUNT(*) AS n FROM memories")).n);
      const before = await count();
      const thirty = await send("/api/settings/auto-cleanup/preview?days=30");
      const sixty = await send("/api/settings/auto-cleanup/preview?days=60");
      const bad = {};
      for (const days of ["abc", "0", "-3", "1.5", ""]) {
        bad[days] = (await send("/api/settings/auto-cleanup/preview?days=" + days)).status;
      }
      const missing = await send("/api/settings/auto-cleanup/preview");
      const noToken = await send("/api/settings/auto-cleanup/preview?days=30", "GET", undefined, {});
      const foreign = await send("/api/settings/auto-cleanup/preview?days=30", "GET", undefined,
        { "x-omms-token": token, origin: "https://evil.example" });
      return { before, after: await count(), thirty, sixty, bad, missing,
        noToken: noToken.status, foreign: foreign.status,
        prompts: Number((await prompts.get("SELECT COUNT(*) AS n FROM user_prompts")).n) };
    `);
    // The memory linked to an old prompt is counted: it goes in the same run (ADR-051).
    expect(result.thirty).toMatchObject({ status: 200, body: { days: 30, count: 4 } });
    expect(result.sixty).toMatchObject({ status: 200, body: { days: 60, count: 0 } });
    expect(result.bad).toEqual({ abc: 400, "0": 400, "-3": 400, "1.5": 400, "": 400 });
    expect(result.missing.status).toBe(400);
    expect(result.missing.body.error).toBe("Invalid days: accepted whole numbers of 1 or more");
    expect(result.noToken).toBe(401);
    expect(result.foreign).toBe(403);
    expect(result.before).toBe(6);
    expect(result.after).toBe(6);
    expect(result.prompts).toBe(1);
  });
});

describe("key route", () => {
  it("saves a pasted reranker key to a user-only file and never returns or logs it", async () => {
    const result = await scenario(`
      const key = "sk-reranker-SECRET-BAD-VALUE";
      const saved = await send("/api/settings/external-api/key", "POST",
        { setting: "rerankerApiKey", source: "paste", name: "reranker", value: key, revision: (await settings()).revision });
      const other = await send("/api/settings/external-api/key", "POST",
        { setting: "embeddingApiKey", source: "env", name: "X_KEY", revision: (await settings()).revision });
      const literal = await send("/api/settings/external-api/key", "POST",
        { setting: key, source: "env", name: "X_KEY", revision: (await settings()).revision });
      const file = join(process.env.HOME, ".config", "omms", "secrets", "reranker.key");
      const snapshot = await send("/api/settings");
      return { saved, other, literal, file, config: readFileSync(configPath, "utf8"),
        fileContent: readFileSync(file, "utf8").trim(), mode: (statSync(file).mode & 0o777).toString(8),
        log: readLog(), snapshot: snapshot.text };
    `);
    const key = "sk-reranker-SECRET-BAD-VALUE";
    expect(result.saved.status).toBe(200);
    expect(result.saved.body.key).toMatchObject({
      source: "file",
      reference: result.file,
      // The reranker key file resolves, though no External API key is set.
      resolvesInWebApp: true,
    });
    expect(typeof result.saved.body.revision).toBe("string");
    expect(result.fileContent).toBe(key);
    if (process.platform !== "win32") expect(result.mode).toBe("600");
    expect(result.config).toContain(`"rerankerApiKey": ${JSON.stringify(`file://${result.file}`)}`);
    expect(result.config).not.toContain("memoryApiKey");
    expect(result.other.status).toBe(400);
    expect(result.other.body.error).toBe("Choose memoryApiKey or rerankerApiKey");
    expect(result.literal.status).toBe(400);
    for (const text of [
      result.saved.text,
      result.other.text,
      result.literal.text,
      result.config,
      result.log,
      result.snapshot,
    ]) {
      expect(text).not.toContain(key);
      expect(text).not.toContain("SECRET-BAD-VALUE");
    }
  });
});

describe("External API test route", () => {
  it("tests the typed model with a pasted key in memory only and redacts the key", async () => {
    const result = await scenario(
      `
      const key = "sk-pasted-SECRET-BAD-VALUE";
      const seen = [];
      const fake = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
        seen.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"),
          model: (await req.json()).model });
        // A server that echoes the key back must not get it into the reply.
        return new Response("bad key " + key, { status: 401 });
      } });
      const url = "http://127.0.0.1:" + fake.port + "/v1";
      const before = readFileSync(configPath, "utf8");
      const tested = await send("/api/settings/external-api/test", "POST",
        { provider: "openai-chat", url, model: "typed-model", key });
      const badUrl = await send("/api/settings/external-api/test", "POST",
        { provider: "openai-chat", url: "SECRET-BAD-VALUE.example/v1", model: "m", key });
      const badProvider = await send("/api/settings/external-api/test", "POST",
        { provider: "SECRET-BAD-VALUE", url, model: "m" });
      const empty = await send("/api/settings/external-api/test", "POST", {});
      fake.stop(true);
      const secrets = join(process.env.HOME, ".config", "omms", "secrets");
      return { tested, badUrl, badProvider, empty, seen,
        unchanged: readFileSync(configPath, "utf8") === before, secretsDir: existsSync(secrets),
        log: readLog() };
    `,
      '{ "memoryProvider": "openai-chat", "memoryModel": "saved-model", "memoryApiUrl": "https://saved.example.invalid/v1", "memoryApiKey": "env://OMMS_ROUTE_TEST_UNSET" }'
    );
    const key = "sk-pasted-SECRET-BAD-VALUE";
    expect(result.seen).toEqual([
      { path: "/v1/chat/completions", auth: `Bearer ${key}`, model: "typed-model" },
    ]);
    expect(result.tested.status).toBe(200);
    expect(result.tested.body.ok).toBe(false);
    // The page words a refused key from the reason and status, never from the provider's reply.
    expect(result.tested.body).toMatchObject({ reason: "refused", status: 401 });
    expect(result.badUrl.status).toBe(400);
    expect(result.badUrl.body.error).toBe(
      "Invalid memoryApiUrl setting: accepted an http:// or https:// URL"
    );
    expect(result.badProvider.status).toBe(400);
    expect(result.badProvider.body.error).toBe("Invalid memoryProvider setting");
    // An empty body tests the saved values, as before: here the saved key does not resolve.
    expect(result.empty.status).toBe(200);
    expect(result.empty.body).toMatchObject({ ok: false });
    expect(result.empty.body.error).toContain("memoryApiKey");
    expect(result.unchanged).toBe(true);
    expect(result.secretsDir).toBe(false);
    for (const text of [
      result.tested.text,
      result.badUrl.text,
      result.badProvider.text,
      result.log,
    ]) {
      expect(text).not.toContain("SECRET-BAD-VALUE");
    }
  });

  it("refuses a pasted key on a network host without Basic Auth", async () => {
    const result = await scenario(`
      const { importConfigApiToken } = await import(${src("services/api-tokens.ts")});
      importConfigApiToken("network-test-token");
      const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747, apiToken: "network-test-token" });
      const response = await network.handleRequest(new Request("http://127.0.0.1:4747/api/settings/external-api/test", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer network-test-token" },
        body: JSON.stringify({ provider: "openai-chat", url: "http://127.0.0.1:9/v1", model: "m", key: "sk-SECRET-BAD-VALUE" }) }));
      return { status: response.status, text: await response.text() };
    `);
    expect(result.status).toBe(403);
    expect(result.text).not.toContain("SECRET-BAD-VALUE");
  });
});
