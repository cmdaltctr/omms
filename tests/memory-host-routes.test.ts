import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const src = (path: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dir, "../src", path)).href);

/** Run web servers in their own process with a temporary home. */
async function scenario(body: string, globalConfig = "{}") {
  const home = mkdtempSync(join(tmpdir(), "omms-host-routes-"));
  dirs.push(home);
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(join(home, ".config", "omms", "omms.jsonc"), globalConfig);
  const script = `
    const { WebServer } = await import(${src("services/web-server.ts")});
    const { getOrCreateAuthToken } = await import(${src("services/auth-token.ts")});
    const token = getOrCreateAuthToken();
    const json = { "content-type": "application/json" };
    const call = (server, path, { method = "GET", body, headers = {}, address = "127.0.0.1" } = {}) =>
      server.handleRequest(new Request("http://127.0.0.1:4747" + path, { method, headers: { ...json, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) }), address);
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
  return { result: JSON.parse(match[1]), home };
}

/** A structurally valid 128 by 128 PNG, as base64. */
function pngBase64(width = 128, height = 128): string {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write("IHDR", 4, "ascii");
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  header.set([8, 6, 0, 0, 0], 16);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    header,
    Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]).toString("base64");
}

it("requires the web token for every host appearance request", async () => {
  const { result } = await scenario(`
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    const auth = { "x-omms-token": token };
    const status = async (path, options) => (await call(server, path, options)).status;
    return {
      readNoToken: await status("/api/host-appearance"),
      putNoToken: await status("/api/host-appearance/pi", { method: "PUT", body: { kind: "icon", icon: "bot" } }),
      deleteNoToken: await status("/api/host-appearance/pi", { method: "DELETE" }),
      readToken: await status("/api/host-appearance", { headers: auth }),
    };
  `);
  expect(result).toEqual({ readNoToken: 401, putNoToken: 401, deleteNoToken: 401, readToken: 200 });
});

it("keeps the host icons when the active memory space changes", async () => {
  const { result } = await scenario(`
    const { initConfig } = await import(${src("config.ts")});
    initConfig(process.cwd());
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    const auth = { "x-omms-token": token };
    const read = async () => (await (await call(server, "/api/host-appearance", { headers: auth })).json()).hosts.pi;
    await call(server, "/api/host-appearance/pi", { method: "PUT", headers: auth, body: { kind: "icon", icon: "bot" } });
    const before = await read();
    const created = (await call(server, "/api/spaces", { method: "POST", headers: auth, body: { name: "Other" } })).status;
    const switched = (await call(server, "/api/spaces/other/switch", { method: "POST", headers: auth })).status;
    const active = (await (await call(server, "/api/web/status", { headers: auth })).json()).activeSpace.id;
    const inOther = await read();
    await call(server, "/api/host-appearance/pi", { method: "PUT", headers: auth, body: { kind: "icon", icon: "cat" } });
    await call(server, "/api/spaces/default/switch", { method: "POST", headers: auth });
    return { created, switched, active, before, inOther, back: await read() };
  `);
  expect([result.created, result.switched, result.active]).toEqual([200, 200, "other"]);
  expect(result.before).toEqual({ kind: "icon", icon: "bot" });
  expect(result.inOther).toEqual({ kind: "icon", icon: "bot" });
  expect(result.back).toEqual({ kind: "icon", icon: "cat" });
});

it("saves, shows and resets a host icon through the web server", async () => {
  const { result } = await scenario(`
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    const auth = { "x-omms-token": token };
    const read = async () => (await (await call(server, "/api/host-appearance", { headers: auth })).json()).hosts;
    const put = await call(server, "/api/host-appearance/opencode", { method: "PUT", headers: auth, body: { kind: "icon", icon: "terminal" } });
    const afterPut = await read();
    const bad = await call(server, "/api/host-appearance/opencode", { method: "PUT", headers: auth, body: { kind: "icon", icon: "../x" } });
    const unknown = await call(server, "/api/host-appearance/cursor", { method: "PUT", headers: auth, body: { kind: "icon", icon: "bot" } });
    const reset = await call(server, "/api/host-appearance/opencode", { method: "DELETE", headers: auth });
    return { put: put.status, afterPut: afterPut.opencode, bad: bad.status, unknown: unknown.status, reset: reset.status, afterReset: (await read()).opencode };
  `);
  expect(result).toEqual({
    put: 200,
    afterPut: { kind: "icon", icon: "terminal" },
    bad: 400,
    unknown: 400,
    reset: 200,
    afterReset: { kind: "default" },
  });
});

it("saves a PNG avatar and refuses a wrong-sized one", async () => {
  const good = pngBase64();
  const small = pngBase64(64, 64);
  const { result } = await scenario(`
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    const auth = { "x-omms-token": token };
    const put = (png) => call(server, "/api/host-appearance/pi", { method: "PUT", headers: auth, body: { kind: "image", png } });
    const ok = await put(${JSON.stringify(good)});
    const refused = await put(${JSON.stringify(small)});
    const hosts = (await (await call(server, "/api/host-appearance", { headers: auth })).json()).hosts;
    return { ok: ok.status, refused: refused.status, image: hosts.pi.image.slice(0, 22) };
  `);
  expect(result).toEqual({ ok: 200, refused: 400, image: "data:image/png;base64," });
});

it("reports whether memories can be saved without exposing a stack", async () => {
  const { result } = await scenario(
    `
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    const auth = { "x-omms-token": token };
    const noToken = (await call(server, "/api/memory/write-health")).status;
    const response = await call(server, "/api/memory/write-health?fresh=1", { headers: auth });
    return { noToken, status: response.status, body: await response.json() };
  `,
    JSON.stringify({
      embeddingApiUrl: "http://127.0.0.1:1/v1",
      embeddingModel: "none",
      embeddingDimensions: 4,
    })
  );
  expect(result.noToken).toBe(401);
  expect(result.status).toBe(200);
  expect(result.body.ok).toBe(false);
  expect(typeof result.body.reason).toBe("string");
  expect(result.body.reason).not.toContain("\n");
  expect(typeof result.body.checkedAt).toBe("number");
});

const web = (path: string) => readFileSync(join(import.meta.dir, "../web/src", path), "utf8");

it("gives the Shared view one Memory injection link row and no controls of its own", () => {
  const shared = web("lib/components/memory/SharedView.tsx");
  expect(shared).toContain('id="shared-memory-injection"');
  expect(shared).toContain("/memory#memory-injection");
  expect(shared).not.toContain("MemoryInjectionSection");
  const row = shared.slice(shared.indexOf("shared-memory-injection"));
  const end = row.indexOf("</a>");
  expect(end).toBeGreaterThan(0);
  expect(row.slice(0, end)).not.toMatch(/<(input|textarea|select|button|Switch)/);
});

it("keeps the Settings page free of a Memory injection section", () => {
  expect(web("lib/components/settings/SettingsView.tsx")).not.toContain("MemoryInjection");
  expect(web("lib/settings-sections.ts")).not.toMatch(/injection/i);
});

it("saves, rejects and resets the Memory injection options through the settings route", async () => {
  const controls = JSON.stringify(
    pathToFileURL(join(import.meta.dir, "../web/src/lib/injection-controls.ts")).href
  );
  const { result } = await scenario(`
    const { injectionSaveEdits, DEFAULT_INJECTION_DRAFT } = await import(${controls});
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    const auth = { "x-omms-token": token };
    const read = async () => (await (await call(server, "/api/settings", { headers: auth })).json());
    const patch = async (edits) => {
      const { revision } = await read();
      const response = await call(server, "/api/settings", { method: "PATCH", headers: auth, body: { edits, revision } });
      return { status: response.status, body: await response.json() };
    };
    const custom = { opening: true, query: "  release notes  ", subagent: false, restore: false, limit: "25" };
    const saved = await patch(injectionSaveEdits(custom, DEFAULT_INJECTION_DRAFT));
    const afterSave = (await read()).settings;
    const tooLong = await patch({ openingContextQuery: "SECRETMARK".repeat(60) });
    const badLimit = await patch({ "compaction.memoryLimit": 0 });
    const reset = await patch(injectionSaveEdits(DEFAULT_INJECTION_DRAFT, custom));
    const afterReset = (await read()).settings;
    const pick = (settings) => Object.fromEntries(
      ["openingContext", "openingContextQuery", "subagentMemory", "compaction.enabled", "compaction.memoryLimit"]
        .map((key) => [key, settings[key].globalValue]));
    const inFile = (settings) => Object.fromEntries(
      ["openingContext", "openingContextQuery", "subagentMemory", "compaction.enabled", "compaction.memoryLimit"]
        .map((key) => [key, settings[key].hasGlobal]));
    return { saved: saved.status, afterSave: pick(afterSave), tooLong, badLimit, reset: reset.status, afterReset: pick(afterReset), afterResetInFile: inFile(afterReset) };
  `);
  expect(result.saved).toBe(200);
  expect(result.afterSave).toEqual({
    openingContext: true,
    openingContextQuery: "release notes",
    subagentMemory: false,
    "compaction.enabled": false,
    "compaction.memoryLimit": 25,
  });
  expect(result.tooLong.status).toBe(400);
  expect(result.tooLong.body.error).toBe(
    "openingContextQuery must be text of 500 characters or fewer"
  );
  expect(JSON.stringify(result.tooLong)).not.toContain("SECRETMARK");
  expect(result.badLimit.status).toBe(400);
  expect(result.badLimit.body.error).toContain("compaction.memoryLimit");
  expect(result.reset).toBe(200);
  expect(result.afterReset).toEqual({
    openingContext: false,
    openingContextQuery: "project architecture, setup, conventions and key decisions",
    subagentMemory: true,
    "compaction.enabled": true,
    "compaction.memoryLimit": 10,
  });
  // Reset removes the keys from the file; the section then shows the defaults.
  expect(Object.values(result.afterResetInFile).some(Boolean)).toBe(false);
});
