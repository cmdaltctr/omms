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
 * snapshot; `post(level, extra?, revision?)` calls the reasoning route with the
 * current revision. The result is the JSON the script returns, plus the final file.
 */
async function scenario(body: string, globalConfig = "{}") {
  const home = mkdtempSync(join(tmpdir(), "omms-model-reasoning-"));
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
    const post = async (level, extra = {}, revision) => send("/api/settings/external-api/reasoning", "POST",
      { revision: revision ?? (await settings()).revision, level, ...extra });
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

const config = (url: string, provider: string, extra = "") =>
  `{ "memoryApiUrl": ${JSON.stringify(url)}, "memoryProvider": ${JSON.stringify(provider)}${extra ? `, ${extra}` : ""} }`;
const OPENROUTER = config("https://openrouter.ai/api/v1", "openai-chat");

describe("reasoning level route", () => {
  it("writes reasoning.effort for Low on OpenRouter", async () => {
    const { result, file } = await scenario(`return await post("low");`, OPENROUTER);
    expect(result.status).toBe(200);
    expect(file.memoryExtraParams).toEqual({ reasoning: { effort: "low" } });
    expect(typeof result.body.revision).toBe("string");
  });

  it("writes effort none for Off on OpenRouter and enabled flags for a toggle model", async () => {
    const off = await scenario(`return await post("off");`, OPENROUTER);
    expect(off.file.memoryExtraParams).toEqual({ reasoning: { effort: "none" } });
    const toggle = await scenario(`return await post("off", { toggle: true });`, OPENROUTER);
    expect(toggle.file.memoryExtraParams).toEqual({ reasoning: { enabled: false } });
    const on = await scenario(`return await post("on", { toggle: true });`, OPENROUTER);
    expect(on.file.memoryExtraParams).toEqual({ reasoning: { enabled: true } });
  });

  it("writes thinking.type for Off on DeepSeek", async () => {
    const { file } = await scenario(
      `return await post("off");`,
      config("https://api.deepseek.com", "openai-chat")
    );
    expect(file.memoryExtraParams).toEqual({ thinking: { type: "disabled" } });
  });

  it("writes reasoning.effort for Medium on the Responses provider", async () => {
    const { file } = await scenario(
      `return await post("medium");`,
      config("https://api.openai.com/v1", "openai-responses")
    );
    expect(file.memoryExtraParams).toEqual({ reasoning: { effort: "medium" } });
  });

  it("writes reasoning_effort for High on another OpenAI Chat endpoint", async () => {
    const { file } = await scenario(
      `return await post("high");`,
      config("https://api.example.com/v1", "openai-chat")
    );
    expect(file.memoryExtraParams).toEqual({ reasoning_effort: "high" });
  });

  it("replaces a saved thinking field and keeps provider and file comments", async () => {
    const saved = `{
  // my endpoint
  "memoryApiUrl": "https://openrouter.ai/api/v1",
  "memoryExtraParams": { "thinking": { "type": "disabled" }, "provider": { "order": ["deepinfra"] } }
}`;
    const { file, raw } = await scenario(`return await post("low");`, saved);
    expect(file.memoryExtraParams).toEqual({
      provider: { order: ["deepinfra"] },
      reasoning: { effort: "low" },
    });
    expect(raw).toContain("// my endpoint");
  });

  it("removes all three fields for Default and drops an empty memoryExtraParams", async () => {
    const saved = config(
      "https://openrouter.ai/api/v1",
      "openai-chat",
      '"memoryExtraParams": { "reasoning": { "effort": "low" }, "thinking": { "type": "disabled" }, "reasoning_effort": "low" }'
    );
    const { result, file } = await scenario(`return await post("default");`, saved);
    expect(result.status).toBe(200);
    expect("memoryExtraParams" in file).toBe(false);
    const kept = await scenario(
      `return await post("default");`,
      config(
        "https://openrouter.ai/api/v1",
        "openai-chat",
        '"memoryExtraParams": { "reasoning": { "effort": "low" }, "provider": { "zdr": true } }'
      )
    );
    expect(kept.file.memoryExtraParams).toEqual({ provider: { zdr: true } });
  });

  it("refuses a level the saved endpoint does not accept and leaves the config unchanged", async () => {
    const chatUrl = config("https://api.example.com/v1", "openai-chat");
    const on = await scenario(`return await post("on");`, chatUrl);
    expect(on.result.status).toBe(400);
    expect(on.raw).toBe(chatUrl);
    const anthropic = config("https://api.anthropic.com", "anthropic");
    const low = await scenario(`return await post("low");`, anthropic);
    expect(low.result.status).toBe(400);
    expect(low.raw).toBe(anthropic);
    const unknown = await scenario(`return await post("turbo");`, OPENROUTER);
    expect(unknown.result.status).toBe(400);
    expect(unknown.raw).toBe(OPENROUTER);
  });

  it("always allows Default, even for a provider with no control", async () => {
    const { result, file } = await scenario(
      `return await post("default");`,
      config(
        "https://api.anthropic.com",
        "anthropic",
        '"memoryExtraParams": { "thinking": { "type": "adaptive" } }'
      )
    );
    expect(result.status).toBe(200);
    expect("memoryExtraParams" in file).toBe(false);
  });

  it("answers 409 for a stale revision and leaves the file alone", async () => {
    const { result, raw } = await scenario(`return await post("low", {}, "stale");`, OPENROUTER);
    expect(result.status).toBe(409);
    expect(raw).toBe(OPENROUTER);
  });
});

describe("settings snapshot memoryReasoning", () => {
  it("holds only the three reasoning members of the global memoryExtraParams", async () => {
    const saved = config(
      "https://openrouter.ai/api/v1",
      "openai-chat",
      '"memoryExtraParams": { "reasoning": { "effort": "low" }, "thinking": { "type": "disabled" }, "reasoning_effort": "high", "provider": { "zdr": true }, "top_p": 0.9 }'
    );
    const { result } = await scenario(`return (await settings()).memoryReasoning;`, saved);
    expect(result).toEqual({
      reasoning: { effort: "low" },
      thinking: { type: "disabled" },
      reasoning_effort: "high",
    });
  });

  it("is an empty object when nothing is saved", async () => {
    const { result } = await scenario(`return (await settings()).memoryReasoning;`, OPENROUTER);
    expect(result).toEqual({});
  });
});

describe("external API calls send the saved level", () => {
  it("puts the saved reasoning field in the Test button request body", async () => {
    const { result } = await scenario(
      `
      const bodies = [];
      const fake = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
        bodies.push(await req.json());
        return new Response("no", { status: 401 });
      } });
      await send("/api/settings/external-api/test", "POST",
        { provider: "openai-chat", url: "http://127.0.0.1:" + fake.port + "/v1", model: "m", key: "sk-local-test" });
      fake.stop(true);
      return bodies;
    `,
      config(
        "https://openrouter.ai/api/v1",
        "openai-chat",
        '"memoryExtraParams": { "reasoning": { "effort": "low" } }'
      )
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].reasoning).toEqual({ effort: "low" });
  });
});
