import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const webServerUrl = pathToFileURL(join(import.meta.dir, "../src/services/web-server.js")).href;

describe("web UI token injection", () => {
  it("injects the token as window.__OMMS_TOKEN__ and gates the API on it", async () => {
    // The token file lives under HOME, so run against a temp HOME in a child process.
    const home = mkdtempSync(join(tmpdir(), "omms-web-token-home-"));
    const dir = mkdtempSync(join(tmpdir(), "omms-web-token-scenario-"));
    tempDirs.push(home, dir);
    const scriptPath = join(dir, "scenario.mjs");
    writeFileSync(
      scriptPath,
      `
const { WebServer } = await import(${JSON.stringify(webServerUrl)});
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
const handle = (path, headers) => server.handleRequest(new Request("http://127.0.0.1:4747" + path, { headers }));
const index = await handle("/");
const html = await index.text();
const token = html.match(/window\\.__OMMS_TOKEN__=("[0-9a-f]+")/)?.[1];
const parsed = token ? JSON.parse(token) : null;
console.log("SCENARIO_RESULT:" + JSON.stringify({
  indexStatus: index.status,
  hasToken: Boolean(parsed),
  legacyGlobal: html.includes("__OPENCODE_MEM_TOKEN__"),
  noHeader: (await handle("/api/unknown-route")).status,
  ommsHeader: (await handle("/api/unknown-route", { "x-omms-token": parsed })).status,
}));
`
    );
    const proc = Bun.spawn(["bun", "run", scriptPath], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const match = text.match(/SCENARIO_RESULT:(.*)$/m);
    if (!match) throw new Error(`scenario produced no result:\n${text}`);
    const result = JSON.parse(match[1]!);

    expect(result.indexStatus).toBe(200);
    expect(result.hasToken).toBe(true);
    expect(result.legacyGlobal).toBe(false);
    expect(result.noHeader).toBe(401);
    expect(result.ommsHeader).not.toBe(401);
  });
});
