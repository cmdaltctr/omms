import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const url = (path: string) => pathToFileURL(join(import.meta.dir, path)).href;

/** Runs `body` in a child process with an isolated HOME, a profile store, and a web server. */
async function scenario(body: string) {
  const home = mkdtempSync(join(tmpdir(), "omms-profiles-route-"));
  dirs.push(home);
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  writeFileSync(configPath, "{}");
  const script = `
    const { CONFIG } = await import(${JSON.stringify(url("../src/config.ts"))});
    CONFIG.storagePath = ${JSON.stringify(join(home, "store"))};
    CONFIG.userEmailOverride = "me@example.com";
    const { userProfileManager } = await import(${JSON.stringify(url("../src/services/user-profile/user-profile-manager.ts"))});
    const item = (d) => ({ category: "c", description: d, confidence: 0.5, frequency: 1 });
    const meId = await userProfileManager.createProfile("me@example.com", "Me", "Me", "me@example.com",
      { preferences: [item("a")], patterns: [], workflows: [] }, 5);
    const botId = await userProfileManager.createProfile("bot@example.com", "Bot", "Bot", "bot@example.com",
      { preferences: [item("b")], patterns: [item("p")], workflows: [] }, 2);
    const { WebServer } = await import(${JSON.stringify(url("../src/services/web-server.ts"))});
    const { getOrCreateAuthToken } = await import(${JSON.stringify(url("../src/services/auth-token.ts"))});
    const token = getOrCreateAuthToken();
    const configPath = ${JSON.stringify(configPath)};
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: process.env.HOME });
    const json = { "content-type": "application/json" };
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
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_LOG_FILE: join(home, "omms.log") },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text + error);
  return JSON.parse(match[1]!);
}

describe("profiles settings routes", () => {
  it("lists profiles, writes userEmailOverride, merges, and guards writes", async () => {
    const result = await scenario(`
      const { readFileSync } = await import("node:fs");
      const list = await (await send("/api/settings/profiles")).json();
      const before = await (await send("/api/settings")).json();
      const foreign = await send("/api/settings/profiles/merge", "POST", { sourceId: botId, targetId: meId },
        { ...json, origin: "https://example.com" });
      const form = await send("/api/settings/profiles/use", "POST", { userId: "bot@example.com" },
        { "content-type": "text/plain" });
      const unknown = await send("/api/settings/profiles/use", "POST",
        { userId: "nobody@example.com", revision: before.revision }, json);
      const use = await send("/api/settings/profiles/use", "POST",
        { userId: "bot@example.com", revision: before.revision }, json);
      const config = readFileSync(configPath, "utf8");
      const merge = await send("/api/settings/profiles/merge", "POST", { sourceId: botId, targetId: meId }, json);
      const mergeBody = await merge.json();
      const after = await (await send("/api/settings/profiles")).json();
      const source = await userProfileManager.getProfileById(botId);
      const changelog = await userProfileManager.getProfileChangelogs(meId, 5);
      return {
        list: list.profiles.map((p) => [p.userId, p.preferences, p.patterns, p.inUse]),
        foreign: foreign.status, form: form.status, unknown: unknown.status,
        use: use.status, config, merge: merge.status, target: mergeBody.target,
        after: after.profiles.map((p) => p.userId), sourceActive: source.isActive,
        changes: changelog.map((c) => c.changeSummary),
      };
    `);
    expect(result.list).toContainEqual(["me@example.com", 1, 0, true]);
    expect(result.list).toContainEqual(["bot@example.com", 1, 1, false]);
    expect(result.foreign).toBe(403);
    expect(result.form).toBe(415);
    expect(result.unknown).toBe(404);
    expect(result.use).toBe(200);
    expect(result.config).toContain('"userEmailOverride": "bot@example.com"');
    expect(result.merge).toBe(200);
    expect(result.target.totalPromptsAnalyzed).toBe(7);
    expect(result.target.patterns).toBe(1);
    expect(result.after).toEqual(["me@example.com"]);
    expect(result.sourceActive).toBe(false);
    expect(result.changes).toContain("Merged profile bot@example.com");
  }, 60_000);
});
