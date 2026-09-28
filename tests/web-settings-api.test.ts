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
  it("reports both backfills and the login item without exposing prompts or creating a ledger", async () => {
    const result = await scenario(`
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { CONFIG } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
      CONFIG.storagePath = join(process.env.HOME, "isolated-store");
      const path = join(CONFIG.storagePath, "import-ledger.db");
      const empty = await (await send("/api/settings/backfill")).json();
      const untouched = !existsSync(path);
      const { getBackfillCutoff, updateBackfillStatus } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/backfill-state.ts")).href)});
      await getBackfillCutoff("pi", 123);
      await updateBackfillStatus("pi", { state: "failed", model: "zai/model",
        counts: { imported: 1, skipped: 2, failed: 3, pending: 4, unresolved: 5 },
        error: new Error("api_key=private-test-value") });
      const backfill = await send("/api/settings/backfill");
      const login = await send("/api/settings/web-autostart");
      return { empty, untouched, status: backfill.status, rows: await backfill.json(),
        loginStatus: login.status, login: await login.json() };
    `);
    expect(result.empty).toEqual({ pi: null, opencode: null });
    expect(result.untouched).toBe(true);
    expect(result.status).toBe(200);
    expect(result.rows.pi).toMatchObject({
      cutoff: 123,
      state: "failed",
      counts: { imported: 1, skipped: 2, failed: 3, pending: 4, unresolved: 5 },
    });
    expect(result.rows.opencode).toBeNull();
    expect(result.loginStatus).toBe(200);
    expect(result.login.state).toBe("not-installed");
    expect(JSON.stringify(result.rows)).not.toContain("private-test-value");
  });
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
    expect(result.body.secrets.memoryApiKey).toMatchObject({
      set: true,
      source: "env",
      reference: "OMMS_SECRET_TEST",
    });
    // The variable name is shown; its value never is.
    expect(JSON.stringify(result.body)).not.toContain("private-test-value");
  });

  it("saves all automatic import and web app settings without changing live model keys", async () => {
    const result = await scenario(
      `
      for (const edits of [
        { autoBackfill: false }, { piBackfillModel: "zai/glm-5-turbo" },
        { opencodeBackfillModel: "zai-coding-plan/glm-5-turbo" },
        { webServerAutoStart: false },
      ]) {
        const snapshot = await (await send("/api/settings")).json();
        const saved = await send("/api/settings", "PATCH", { edits, revision: snapshot.revision },
          { "content-type": "application/json" });
        if (saved.status !== 200) throw new Error(await saved.text());
      }
      return (await (await send("/api/settings")).json()).settings;
    `,
      '{ "piProvider": "openai-codex", "piModel": "gpt-test" }'
    );
    expect(result.autoBackfill.globalValue).toBe(false);
    expect(result.webServerAutoStart.globalValue).toBe(false);
    expect(result.piBackfillModel.globalValue).toBe("zai/glm-5-turbo");
    expect(result.opencodeBackfillModel.globalValue).toBe("zai-coding-plan/glm-5-turbo");
    expect(result.piProvider.globalValue).toBe("openai-codex");
    expect(result.piModel.globalValue).toBe("gpt-test");
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

  it("guards Run now, Pause, and Resume and needs the external API without a host", async () => {
    const result = await scenario(
      `
      const { join } = await import("node:path");
      const { CONFIG } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
      CONFIG.storagePath = join(process.env.HOME, "isolated-store");
      const json = { "content-type": "application/json" };
      const form = await send("/api/settings/backfill/pi/run", "POST", {}, { "content-type": "text/plain" });
      const foreign = await send("/api/settings/backfill/pi/run", "POST", {}, { ...json, origin: "https://example.com" });
      const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747, apiToken: "network-test-token" });
      const noToken = await network.handleRequest(new Request("http://127.0.0.1:4747/api/settings/backfill/pi/pause", {
        method: "POST", headers: { ...json, "x-omms-token": token }, body: "{}" }));
      CONFIG.piBackfillModel = "zai/glm-5-turbo";
      const hostModel = await send("/api/settings/backfill/pi/run", "POST", {}, json);
      CONFIG.opencodeBackfillModel = "external";
      CONFIG.memoryModel = undefined;
      const unconfigured = await send("/api/settings/backfill/opencode/run", "POST", {}, json);
      const pause = await send("/api/settings/backfill/opencode/pause", "POST", {}, json);
      const runs = await (await send("/api/settings/backfill/runs")).json();
      const { startImportRun } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/importer/import-runs.ts")).href)});
      CONFIG.piBackfillModel = "external";
      CONFIG.memoryModel = "m"; CONFIG.memoryApiUrl = "https://x.invalid"; CONFIG.memoryApiKey = "k";
      await startImportRun("pi", "cli");
      const busy = await send("/api/settings/backfill/pi/run", "POST", {}, json);
      await send("/api/settings/backfill/pi/pause", "POST", {}, json);
      const refusedResume = await send("/api/settings/backfill/pi/resume", "POST", {}, json);
      const afterResume = (await (await send("/api/settings/backfill/runs")).json()).pi.run.paused;
      return { form: form.status, foreign: foreign.status, noToken: noToken.status,
        hostModel: [hostModel.status, (await hostModel.json()).error],
        unconfigured: [unconfigured.status, (await unconfigured.json()).error],
        pause: pause.status, paused: runs.opencode.run.paused,
        piUnavailable: runs.pi.runNowUnavailable,
        busy: [busy.status, (await busy.json()).error],
        refusedResume: refusedResume.status, afterResume };
    `
    );
    expect(result.form).toBe(415);
    expect(result.foreign).toBe(403);
    expect(result.noToken).toBe(401);
    expect(result.hostModel).toEqual([
      409,
      "Open Pi, or choose the external API for Pi's backfill",
    ]);
    expect(result.unconfigured[0]).toBe(409);
    expect(result.unconfigured[1]).toContain("memoryModel is not configured");
    expect(result.pause).toBe(200);
    expect(result.paused).toBe(true);
    expect(result.piUnavailable).toContain("Open Pi");
    expect(result.busy).toEqual([409, "A Pi import is already running"]);
    // A refused Resume keeps the backfill paused.
    expect(result.refusedResume).toBe(409);
    expect(result.afterResume).toBe(true);
  });

  it("saves a pasted key to a user-only file and never returns or logs it", async () => {
    const result = await scenario(`
      const { readFileSync, statSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const json = { "content-type": "application/json" };
      const settings = async () => (await send("/api/settings")).json();
      const key = "sk-pasted-private-value";
      const saved = await send("/api/settings/external-api/key", "POST",
        { source: "paste", name: "zai", value: key, revision: (await settings()).revision }, json);
      const savedText = await saved.text();
      const again = await send("/api/settings/external-api/key", "POST",
        { source: "paste", name: "zai", value: key, revision: (await settings()).revision }, json);
      const againText = await again.text();
      const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747, apiToken: "network-test-token" });
      const remote = await network.handleRequest(new Request("http://127.0.0.1:4747/api/settings/external-api/key", {
        method: "POST", headers: { ...json, authorization: "Bearer network-test-token" },
        body: JSON.stringify({ source: "paste", name: "remote", value: key, revision: "x" }) }));
      const dir = join(process.env.HOME, ".config", "omms", "secrets");
      const file = join(dir, "zai.key");
      const config = readFileSync(configPath, "utf8");
      const log = existsSync(process.env.OMMS_LOG_FILE) ? readFileSync(process.env.OMMS_LOG_FILE, "utf8") : "";
      const snapshot = JSON.stringify(await settings());
      return { status: saved.status, savedText, again: again.status, againText,
        remote: remote.status, remoteFile: existsSync(join(dir, "remote.key")),
        fileMode: (statSync(file).mode & 0o777).toString(8), dirMode: (statSync(dir).mode & 0o777).toString(8),
        fileContent: readFileSync(file, "utf8").trim(), config, log, snapshot, file };
    `);
    const key = "sk-pasted-private-value";
    expect(result.status).toBe(200);
    expect(result.again).toBe(409);
    expect(result.remote).toBe(403);
    expect(result.remoteFile).toBe(false);
    expect(result.fileContent).toBe(key);
    if (process.platform !== "win32") {
      expect(result.fileMode).toBe("600");
      expect(result.dirMode).toBe("700");
    }
    expect(result.config).toContain(`"memoryApiKey": "file://${result.file}"`);
    for (const text of [
      result.savedText,
      result.againText,
      result.config,
      result.log,
      result.snapshot,
    ]) {
      expect(text).not.toContain(key);
    }
  });

  it("saves an env reference and reports it does not resolve in the web app", async () => {
    const result = await scenario(`
      const json = { "content-type": "application/json" };
      const before = await (await send("/api/settings")).json();
      const saved = await send("/api/settings/external-api/key", "POST",
        { source: "env", name: "OMMS_MISSING_TEST_KEY", revision: before.revision }, json);
      const missingFile = await send("/api/settings/external-api/key", "POST",
        { source: "file", path: "/no/such/omms.key", revision: before.revision }, json);
      const after = await (await send("/api/settings")).json();
      return { saved: saved.status, missingFile: missingFile.status, key: after.externalKey };
    `);
    expect(result.saved).toBe(200);
    expect(result.missingFile).toBe(400);
    expect(result.key).toMatchObject({
      source: "env",
      reference: "OMMS_MISSING_TEST_KEY",
      resolvesInWebApp: false,
    });
    expect(result.key.warning).toContain("shell profile");
  });

  it("lists import sessions over guarded JSON POSTs with metadata only", async () => {
    const result = await scenario(`
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const root = process.env.HOME + "/pi-sessions";
      mkdirSync(root, { recursive: true });
      writeFileSync(root + "/s.jsonl", JSON.stringify({ type: "session", version: 3, id: "sess-1", cwd: process.env.HOME }) + "\\n" +
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "secret prompt text" } }) + "\\n");
      mkdirSync(process.env.HOME + "/code/app/.git", { recursive: true });
      writeFileSync(root + "/gone.jsonl", JSON.stringify({ type: "session", version: 3, id: "sess-2", cwd: process.env.HOME + "/code/app-feat-x" }) + "\\n" +
        JSON.stringify({ type: "message", id: "m2", parentId: null, timestamp: "2026-01-02T00:00:00Z", message: { role: "user", content: "other prompt" } }) + "\\n");
      const json = { "content-type": "application/json" };
      const validate = await send("/api/settings/imports/sources/validate", "POST", { host: "pi", path: root }, json);
      const source = await validate.json();
      const list = await send("/api/settings/imports/sessions", "POST", { host: "pi", source: source.sourceToken, scope: "all-projects", refresh: true }, json);
      const listed = await list.json();
      const maps = await (await send("/api/settings/import-maps")).json();
      const relative = await send("/api/settings/imports/sources/validate", "POST", { host: "pi", path: "pi-sessions" }, json);
      const getList = await send("/api/settings/imports/sessions");
      const readiness = await send("/api/settings/imports/readiness");
      const browse = await send("/api/settings/imports/sources/browse", "POST", { host: "pi", path: process.env.HOME }, json);
      return {
        validate: validate.status, kind: source.kind,
        list: list.status, keys: listed.rows.map((row) => row.key), text: JSON.stringify(listed),
        relative: relative.status, getList: getList.status, maps,
        readiness: readiness.status, readinessKeys: Object.keys(await readiness.json()).sort(),
        browse: browse.status, entries: (await browse.json()).entries.map((entry) => entry.name),
      };
    `);
    expect(result.validate).toBe(200);
    expect(result.kind).toBe("pi-folder");
    expect(result.list).toBe(200);
    expect(result.keys).toEqual(["s.jsonl", "gone.jsonl"]);
    // The listing feeds the Directory maps list, with a suggestion and no content.
    expect(result.maps.pi).toEqual([
      {
        directory: expect.stringContaining("code/app-feat-x"),
        sessions: 1,
        suggestion: expect.stringMatching(/code[\\/]app$/),
      },
    ]);
    expect(JSON.stringify(result.maps)).not.toContain("other prompt");
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
