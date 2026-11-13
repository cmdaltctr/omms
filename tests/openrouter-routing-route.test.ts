import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "jsonc-parser";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * Runs `body` in a child process with a scratch HOME and a WebServer that never
 * starts. `send(path, method, body)` calls the server; `settings()` reads the
 * snapshot; `post(routing, revision?)` calls the routing route with the current
 * revision. The result is the JSON the script returns, plus the final file.
 */
async function scenario(body: string, globalConfig = "{}") {
  const home = mkdtempSync(join(tmpdir(), "omms-openrouter-routing-"));
  dirs.push(home);
  const project = join(home, "project");
  mkdirSync(join(project, ".opencode"), { recursive: true });
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(configPath, globalConfig);
  const serverUrl = pathToFileURL(join(import.meta.dir, "../src/services/web-server.ts")).href;
  const tokenUrl = pathToFileURL(join(import.meta.dir, "../src/services/auth-token.ts")).href;
  const script = `
    const { WebServer } = await import(${JSON.stringify(serverUrl)});
    const { getOrCreateAuthToken } = await import(${JSON.stringify(tokenUrl)});
    const token = getOrCreateAuthToken();
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: ${JSON.stringify(project)} });
    const send = async (path, method = "GET", body) => {
      const response = await server.handleRequest(new Request("http://127.0.0.1:4747" + path, {
        method, headers: { "x-omms-token": token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
      const text = await response.text();
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      return { status: response.status, body: parsed };
    };
    const settings = async () => (await send("/api/settings")).body;
    const post = async (routing, revision) => send("/api/settings/external-api/openrouter-routing", "POST",
      { revision: revision ?? (await settings()).revision, routing });
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
    },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text);
  return {
    result: JSON.parse(match[1]!),
    file: parse(readFileSync(configPath, "utf8")) as Record<string, any>,
    raw: readFileSync(configPath, "utf8"),
  };
}

/** A saved global config whose endpoint is OpenRouter, so a routing save is allowed. */
const OPENROUTER_URL = '"memoryApiUrl": "https://openrouter.ai/api/v1"';
const withOpenRouter = (extra = "") => `{ ${OPENROUTER_URL}${extra ? `, ${extra}` : ""} }`;

describe("OpenRouter routing route", () => {
  it("writes the exact provider object from the spec scenario", async () => {
    const { result, file } = await scenario(
      `
      return await post({ data_collection: "deny", zdr: true, order: ["deepinfra"], only: ["deepinfra"], allow_fallbacks: false });
    `,
      withOpenRouter()
    );
    const expected = {
      data_collection: "deny",
      zdr: true,
      order: ["deepinfra"],
      only: ["deepinfra"],
      allow_fallbacks: false,
    };
    expect(result.status).toBe(200);
    expect(result.body.provider).toEqual(expected);
    expect(typeof result.body.revision).toBe("string");
    expect(file.memoryExtraParams.provider).toEqual(expected);
  });

  it("keeps other memoryExtraParams members and unknown provider fields", async () => {
    const saved = `{
      // keep this comment
      "memoryApiUrl": "https://openrouter.ai/api/v1",
      "memoryExtraParams": {
        "thinking": { "type": "adaptive" },
        "provider": { "sort": "price", "order": ["old"], "only": ["old"], "zdr": true }
      }
    }`;
    const { result, file, raw } = await scenario(
      `return await post({ data_collection: "deny", order: ["deepinfra", "novita"] });`,
      saved
    );
    expect(result.status).toBe(200);
    expect(file.memoryExtraParams.thinking).toEqual({ type: "adaptive" });
    // The five managed keys are replaced by the posted ones; `sort` stays.
    expect(file.memoryExtraParams.provider).toEqual({
      sort: "price",
      data_collection: "deny",
      order: ["deepinfra", "novita"],
    });
    expect(result.body.provider).toEqual(file.memoryExtraParams.provider);
    expect(raw).toContain("// keep this comment");
  });

  it("removes provider when cleared, and memoryExtraParams when nothing else is left", async () => {
    const onlyProvider = await scenario(
      `return await post({});`,
      `{ "memoryExtraParams": { "provider": { "zdr": true } } }`
    );
    expect(onlyProvider.result.status).toBe(200);
    expect(onlyProvider.result.body.provider).toBeNull();
    expect(onlyProvider.file).not.toHaveProperty("memoryExtraParams");

    const withThinking = await scenario(
      `return await post({});`,
      `{ "memoryExtraParams": { "thinking": { "type": "adaptive" }, "provider": { "zdr": true } } }`
    );
    expect(withThinking.file.memoryExtraParams).toEqual({ thinking: { type: "adaptive" } });

    const keepsSort = await scenario(
      `return await post({});`,
      `{ "memoryExtraParams": { "provider": { "zdr": true, "sort": "price" } } }`
    );
    expect(keepsSort.file.memoryExtraParams.provider).toEqual({ sort: "price" });
  });

  it("clearing when nothing is saved leaves the file alone", async () => {
    const { result, file } = await scenario(`return await post({});`, `{ "memoryModel": "m" }`);
    expect(result.status).toBe(200);
    expect(result.body.provider).toBeNull();
    expect(file).toEqual({ memoryModel: "m" });
  });

  it("refuses a stale revision with 409 and writes nothing", async () => {
    const { result, file } = await scenario(
      `
      const stale = (await settings()).revision;
      const first = await post({ zdr: true });
      const second = await post({ data_collection: "deny" }, stale);
      return { first: first.status, second };
    `,
      withOpenRouter()
    );
    expect(result.first).toBe(200);
    expect(result.second.status).toBe(409);
    expect(typeof result.second.body.error).toBe("string");
    expect(file.memoryExtraParams.provider).toEqual({ zdr: true });
  });

  it("accepts a second save with the revision the first one returned", async () => {
    const { result, file } = await scenario(
      `
      const first = await post({ zdr: true });
      const second = await post({ order: ["a"] }, first.body.revision);
      return { first: first.status, second: second.status };
    `,
      withOpenRouter()
    );
    expect(result).toEqual({ first: 200, second: 200 });
    expect(file.memoryExtraParams.provider).toEqual({ order: ["a"] });
  });

  it("builds the edits inside the save queue, so the second of two concurrent saves sees the first", async () => {
    // Both saves carry the same base revision. The first writes `order`; the second clears.
    // Read inside the queue, the second sees the first's provider and removes it. Read
    // before the queue, it sees an empty file, writes nothing and the first's order stays.
    const { result, file } = await scenario(
      `
      const revision = (await settings()).revision;
      const [first, second] = await Promise.all([
        post({ order: ["deepinfra"] }, revision),
        post({}, revision),
      ]);
      return { first: first.status, second: second.status };
    `,
      withOpenRouter()
    );
    expect(result).toEqual({ first: 200, second: 200 });
    expect(file).not.toHaveProperty("memoryExtraParams");
  });

  it("refuses a routing save unless the saved endpoint is exactly openrouter.ai", async () => {
    const attempt = (url: string) =>
      scenario(`return await post({ zdr: true });`, `{ "memoryApiUrl": ${JSON.stringify(url)} }`);
    for (const url of [
      "https://api.openai.com/v1",
      "https://openrouter.ai.evil.com/v1",
      "https://evil.com/openrouter.ai",
    ]) {
      const { result, file } = await attempt(url);
      expect([url, result.status]).toEqual([url, 400]);
      expect(result.body.error).toBe(
        "Save the OpenRouter endpoint first. Routing applies only to an OpenRouter API URL."
      );
      expect(file).not.toHaveProperty("memoryExtraParams");
    }
    const noUrl = await scenario(`return await post({ zdr: true });`);
    expect(noUrl.result.status).toBe(400);
    expect(noUrl.file).not.toHaveProperty("memoryExtraParams");
  });

  it("allows a routing save when the saved endpoint is openrouter.ai", async () => {
    const { result, file } = await scenario(`return await post({ zdr: true });`, withOpenRouter());
    expect(result.status).toBe(200);
    expect(file.memoryExtraParams.provider).toEqual({ zdr: true });
  });

  it("always allows clearing, so a stale provider can go after the endpoint changed", async () => {
    const { result, file } = await scenario(
      `return await post({});`,
      `{ "memoryApiUrl": "https://api.openai.com/v1", "memoryExtraParams": { "provider": { "zdr": true } } }`
    );
    expect(result.status).toBe(200);
    expect(result.body.provider).toBeNull();
    expect(file).not.toHaveProperty("memoryExtraParams");
  });

  it("routing null removes the whole provider object, including unmanaged fields", async () => {
    const { result, file } = await scenario(
      `return await post(null);`,
      `{ "memoryApiUrl": "https://openrouter.ai/api/v1", "memoryExtraParams": { "provider": { "sort": "price", "zdr": true } } }`
    );
    expect(result.status).toBe(200);
    expect(result.body.provider).toBeNull();
    expect(typeof result.body.revision).toBe("string");
    expect(file).not.toHaveProperty("memoryExtraParams");
  });

  it("routing null keeps the other memoryExtraParams members", async () => {
    const { result, file } = await scenario(
      `return await post(null);`,
      `{ "memoryExtraParams": { "thinking": { "type": "adaptive" }, "provider": { "sort": "price" } } }`
    );
    expect(result.status).toBe(200);
    expect(file.memoryExtraParams).toEqual({ thinking: { type: "adaptive" } });
  });

  it("routing null is allowed whatever the saved endpoint is", async () => {
    const { result, file } = await scenario(
      `return await post(null);`,
      `{ "memoryApiUrl": "https://api.openai.com/v1", "memoryExtraParams": { "provider": { "sort": "price", "zdr": true } } }`
    );
    expect(result.status).toBe(200);
    expect(result.body.provider).toBeNull();
    expect(file).not.toHaveProperty("memoryExtraParams");
  });

  it("routing null refuses a stale revision with 409 and writes nothing", async () => {
    const { result, file } = await scenario(
      `
      const stale = (await settings()).revision;
      await post({ zdr: true });
      return await post(null, stale);
    `,
      withOpenRouter()
    );
    expect(result.status).toBe(409);
    expect(file.memoryExtraParams.provider).toEqual({ zdr: true });
  });

  it("routing {} still clears only the managed fields", async () => {
    const { file } = await scenario(
      `return await post({});`,
      `{ "memoryApiUrl": "https://api.openai.com/v1", "memoryExtraParams": { "provider": { "sort": "price", "zdr": true } } }`
    );
    expect(file.memoryExtraParams.provider).toEqual({ sort: "price" });
  });

  it("refuses a missing revision and invalid routing with 400 and writes nothing", async () => {
    const { result, raw } = await scenario(`
      const send2 = (payload) => send("/api/settings/external-api/openrouter-routing", "POST", payload);
      const revision = (await settings()).revision;
      const tooMany = Array.from({ length: 21 }, (_, i) => "p" + i);
      return {
        noRevision: (await send2({ routing: { zdr: true } })).status,
        numericRevision: (await send2({ revision: 5, routing: {} })).status,
        noRouting: (await send2({ revision })).status,
        arrayRouting: (await send2({ revision, routing: [] })).status,
        badSlug: (await send2({ revision, routing: { order: ["Bad Slug"] } })).status,
        emptySegment: (await send2({ revision, routing: { only: ["a//b"] } })).status,
        trailingSlash: (await send2({ revision, routing: { only: ["a/"] } })).status,
        leadingSlash: (await send2({ revision, routing: { only: ["/a"] } })).status,
        fourSegments: (await send2({ revision, routing: { only: ["a/b/c/d"] } })).status,
        badSegment: (await send2({ revision, routing: { only: ["a/-b"] } })).status,
        leadingDash: (await send2({ revision, routing: { only: ["-a"] } })).status,
        notString: (await send2({ revision, routing: { order: [1] } })).status,
        notArray: (await send2({ revision, routing: { order: "a" } })).status,
        tooMany: (await send2({ revision, routing: { order: tooMany } })).status,
        duplicate: (await send2({ revision, routing: { order: ["a", "A"] } })).status,
        unknownKey: (await send2({ revision, routing: { sort: "price" } })).status,
        denyOff: (await send2({ revision, routing: { data_collection: "allow" } })).status,
        zdrFalse: (await send2({ revision, routing: { zdr: false } })).status,
        fallbackTrue: (await send2({ revision, routing: { allow_fallbacks: true } })).status,
        message: (await send2({ revision, routing: { order: ["Bad Slug"] } })).body.error,
      };
    `);
    const { message, ...statuses } = result;
    for (const [name, status] of Object.entries(statuses))
      expect([name, status]).toEqual([name, 400]);
    expect(typeof message).toBe("string");
    expect(raw).toBe("{}");
  });

  it("accepts a full endpoint slug with a variant or region segment", async () => {
    const { result, file } = await scenario(
      `return await post({ order: ["google-vertex/us-east5", "baseten/fp4/us"], only: ["google-vertex/us-east5"], allow_fallbacks: false });`,
      withOpenRouter()
    );
    expect(result.status).toBe(200);
    expect(file.memoryExtraParams.provider).toEqual({
      order: ["google-vertex/us-east5", "baseten/fp4/us"],
      only: ["google-vertex/us-east5"],
      allow_fallbacks: false,
    });
  });

  it("returns the saved provider object in the settings snapshot", async () => {
    const { result } = await scenario(
      `
      const before = (await settings()).openrouterProvider;
      await post({ zdr: true, order: ["deepinfra"] });
      const after = (await settings()).openrouterProvider;
      return { before, after };
    `,
      withOpenRouter()
    );
    expect(result.before).toBeNull();
    expect(result.after).toEqual({ zdr: true, order: ["deepinfra"] });
  });

  it("returns null in the snapshot when provider is not a plain object", async () => {
    const { result } = await scenario(
      `return (await settings()).openrouterProvider;`,
      `{ "memoryExtraParams": { "provider": "deepinfra" } }`
    );
    expect(result).toBeNull();
  });

  it("does not let the general settings save edit memoryExtraParams", async () => {
    const { result, raw } = await scenario(`
      const revision = (await settings()).revision;
      const edit = (edits) => send("/api/settings", "PATCH", { revision, edits });
      return {
        whole: (await edit({ memoryExtraParams: { provider: { zdr: true } } })).status,
        nested: (await edit({ "memoryExtraParams.provider": { zdr: true } })).status,
      };
    `);
    expect(result).toEqual({ whole: 400, nested: 400 });
    expect(raw).toBe("{}");
  });

  it("validates the model on the provider list route", async () => {
    const { result } = await scenario(`
      const get = async (query) => send("/api/settings/external-api/openrouter-providers" + query);
      const missing = await get("");
      const malformed = await get("?model=" + encodeURIComponent("no-slash"));
      const climbing = await get("?model=" + encodeURIComponent("../x"));
      const spaces = await get("?model=" + encodeURIComponent("a b/c"));
      return { missing, malformed, climbing, spaces };
    `);
    for (const name of ["missing", "malformed", "climbing", "spaces"]) {
      expect([name, result[name].status]).toEqual([name, 400]);
      expect(typeof result[name].body.error).toBe("string");
    }
  });

  it("serves the provider list from the server with no key sent", async () => {
    const { result } = await scenario(`
      const calls = [];
      globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), auth: new Headers(init?.headers).has("authorization") });
        if (String(url).endsWith("/endpoints/zdr")) {
          return new Response(JSON.stringify({ data: [{ model_id: "a/b", tag: "deepinfra/fp4", safety_retention: false }] }));
        }
        return new Response(JSON.stringify({ data: { endpoints: [
          { tag: "deepinfra/fp4", provider_name: "DeepInfra", model_id: "a/b" },
          { tag: "novita", provider_name: "Novita", model_id: "a/b" } ] } }));
      };
      const response = await send("/api/settings/external-api/openrouter-providers?model=a%2Fb");
      return { response, calls };
    `);
    expect(result.response.status).toBe(200);
    expect(result.response.body).toEqual({
      ok: true,
      providers: [
        { slug: "deepinfra", name: "DeepInfra", policy: "zdr" },
        { slug: "novita", name: "Novita", policy: "unknown" },
      ],
    });
    expect(result.calls.some((call: { auth: boolean }) => call.auth)).toBe(false);
  });

  it("serves the model list from the server with no key sent", async () => {
    const { result } = await scenario(`
      const calls = [];
      globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), auth: new Headers(init?.headers).has("authorization") });
        return new Response(JSON.stringify({ data: [
          { id: "z/last", name: "Last", pricing: { prompt: "1" } },
          { id: "a/first", name: "First" } ] }));
      };
      const response = await send("/api/settings/external-api/openrouter-models");
      return { response, calls };
    `);
    expect(result.response.status).toBe(200);
    expect(result.response.body).toEqual({
      ok: true,
      models: [
        { id: "a/first", name: "First" },
        { id: "z/last", name: "Last" },
      ],
    });
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].url).toBe("https://openrouter.ai/api/v1/models");
    expect(result.calls[0].auth).toBe(false);
  });

  it("reports a model list upstream problem as 200 with ok false", async () => {
    const { result } = await scenario(`
      globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
      return await send("/api/settings/external-api/openrouter-models");
    `);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(false);
    expect(typeof result.body.error).toBe("string");
  });

  it("reports an upstream problem as 200 with ok false", async () => {
    const { result } = await scenario(`
      globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
      return await send("/api/settings/external-api/openrouter-providers?model=a%2Fb");
    `);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: false, reason: "unreachable" });
    expect(typeof result.body.error).toBe("string");
  });
});
