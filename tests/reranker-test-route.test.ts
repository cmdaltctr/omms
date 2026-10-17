import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const webServerUrl = pathToFileURL(join(import.meta.dir, "../src/services/web-server.ts")).href;
const authTokenUrl = pathToFileURL(join(import.meta.dir, "../src/services/auth-token.ts")).href;
const apiTokensUrl = pathToFileURL(join(import.meta.dir, "../src/services/api-tokens.ts")).href;

async function routeScenario(body: string, env: Record<string, string> = {}): Promise<any> {
  const home = mkdtempSync(join(tmpdir(), "omms-reranker-route-"));
  tempDirs.push(home);
  const project = join(home, "project");
  mkdirSync(join(project, ".opencode"), { recursive: true });
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(join(home, ".config", "omms", "omms.jsonc"), "{}");
  const script = `
    const { WebServer } = await import(${JSON.stringify(webServerUrl)});
    const { getOrCreateAuthToken } = await import(${JSON.stringify(authTokenUrl)});
    const token = getOrCreateAuthToken();
    (await import(${JSON.stringify(apiTokensUrl)})).importConfigApiToken("network-test-token");
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: ${JSON.stringify(project)} });
    const send = (path, method = "GET", body, headers = {}) => server.handleRequest(
      new Request("http://127.0.0.1:4747" + path, { method,
        headers: { "x-omms-token": token, ...(method === "POST" && body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }),
      "127.0.0.1"
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
      ...env,
    },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text);
  return JSON.parse(match[1]);
}

const VALID_DRAFT = {
  rerankerApiUrl: "http://127.0.0.1:3008/v1",
  rerankerModel: "Qwen3-Reranker-0.6B",
};

/** A fetch stub inside the scenario that records the request and replies canned data. */
const STUB_FETCH = `
  const fetchCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const mode = process.env.OMMS_TEST_FETCH_MODE ?? "ok";
    if (mode === "down") throw new TypeError("connect ECONNREFUSED 127.0.0.1:3008");
    if (mode === "short") return Response.json({ results: [{ index: 0, relevance_score: 0.9 }] });
    if (mode === "slow")
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1500);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    return Response.json({ results: [
      { index: 1, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.2 },
    ] });
  };
`;

describe("reranker test route", () => {
  it("sends two fixed sample documents and reports success", async () => {
    const result = await routeScenario(`
      ${STUB_FETCH}
      const response = await send("/api/settings/reranker/test", "POST", ${JSON.stringify(VALID_DRAFT)});
      globalThis.fetch = realFetch;
      return { status: response.status, body: await response.json(), fetchCalls };
    `);
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.fetchCalls).toHaveLength(1);
    expect(result.fetchCalls[0].url).toBe("http://127.0.0.1:3008/v1/rerank");
    const requestBody = result.fetchCalls[0].body;
    expect(requestBody.model).toBe("Qwen3-Reranker-0.6B");
    expect(requestBody.documents).toHaveLength(2);
    expect(requestBody.top_n).toBe(2);
    expect(typeof requestBody.query).toBe("string");
    // The reply never carries memory text: success and metadata only.
    expect(JSON.stringify(result.body)).not.toContain("documents");
  });

  it("reports a failure code when the server is down or the reply is short", async () => {
    for (const mode of ["down", "short"]) {
      const result = await routeScenario(
        `
        ${STUB_FETCH}
        const response = await send("/api/settings/reranker/test", "POST", ${JSON.stringify(VALID_DRAFT)});
        globalThis.fetch = realFetch;
        return { status: response.status, body: await response.json() };
      `,
        { OMMS_TEST_FETCH_MODE: mode }
      );
      expect(result.status).toBe(200);
      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe(
        mode === "down" ? "reranker_unreachable" : "reranker_invalid_reply"
      );
    }
  });

  it("uses the drafted timeout: a slow server falls back within it", async () => {
    const result = await routeScenario(
      `
      ${STUB_FETCH}
      const response = await send("/api/settings/reranker/test", "POST",
        { ...${JSON.stringify(VALID_DRAFT)}, rerankerTimeoutMs: 500 });
      globalThis.fetch = realFetch;
      return { status: response.status, body: await response.json() };
    `,
      { OMMS_TEST_FETCH_MODE: "slow" }
    );
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(false);
    expect(result.body.code).toBe("reranker_timeout");
  });

  it("refuses invalid drafts without echoing the value", async () => {
    const result = await routeScenario(`
      const json = { "content-type": "application/json" };
      const rows = [];
      const invalid = [
        [{ rerankerApiUrl: "ftp://x", rerankerModel: "m" }, "rerankerApiUrl"],
        [{ rerankerApiUrl: "http://127.0.0.1:3008/v1", rerankerModel: " " }, "rerankerModel"],
        [{ ...${JSON.stringify(VALID_DRAFT)}, rerankerApiKey: "sk-literal" }, "rerankerApiKey"],
        [{ ...${JSON.stringify(VALID_DRAFT)}, rerankerTimeoutMs: 499 }, "rerankerTimeoutMs"],
        [{ rerankerApiUrl: "SECRET-BAD-URL", rerankerModel: "m" }, "rerankerApiUrl"],
      ];
      for (const [draft, key] of invalid) {
        const response = await send("/api/settings/reranker/test", "POST", draft, json);
        rows.push({ key, status: response.status, error: (await response.json()).error });
      }
      return { rows };
    `);
    for (const row of result.rows) {
      expect(row.status, row.key).toBe(400);
      expect(row.error).toContain(row.key);
    }
    expect(
      result.rows.find((row: { error?: string }) => row.error?.includes("SECRET-BAD"))
    ).toBeUndefined();
  });

  it("keeps the embedding route's origin, method, and token guards", async () => {
    const result = await routeScenario(`
      const json = { "content-type": "application/json" };
      const get = await send("/api/settings/reranker/test", "GET", undefined, json);
      const foreign = await send("/api/settings/reranker/test", "POST", ${JSON.stringify(VALID_DRAFT)},
        { origin: "https://example.com", "content-type": "application/json" });
      const form = await send("/api/settings/reranker/test", "PATCH", ${JSON.stringify(VALID_DRAFT)},
        { "content-type": "text/plain" });
      const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747, apiToken: "network-test-token" });
      const noToken = await network.handleRequest(new Request("http://127.0.0.1:4747/api/settings/reranker/test", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(${JSON.stringify(VALID_DRAFT)}) }));
      return { get: get.status, foreign: foreign.status, form: form.status, noToken: noToken.status };
    `);
    expect(result.get).toBe(404);
    expect(result.foreign).toBe(403);
    // The shared JSON media guard answers before the route (415, not 404).
    expect(result.form).toBe(415);
    expect(result.noToken).toBe(401);
  });
});
