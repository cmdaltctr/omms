import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const authTokenUrl = pathToFileURL(join(import.meta.dir, "../src/services/auth-token.js")).href;

/** Token paths resolve from HOME at import, so each scenario runs in a child process. */
async function runTokenScenario(home: string): Promise<any> {
  const dir = mkdtempSync(join(tmpdir(), "omms-auth-token-scenario-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(
    scriptPath,
    `
const auth = await import(${JSON.stringify(authTokenUrl)});
const token = auth.getOrCreateAuthToken();
const check = (headers) => auth.isAuthorizedApiRequest(new Request("http://localhost/api/stats", { headers }));
console.log("SCENARIO_RESULT:" + JSON.stringify({
  token,
  omms: check({ "x-omms-token": token }),
  legacy: check({ "x-opencode-mem-token": token }),
  wrong: check({ "x-omms-token": "wrong" }),
  none: check({}),
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
  return JSON.parse(match[1]!);
}

describe("local web API auth token", () => {
  it("creates the token under ~/.omms with user-only permissions", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-auth-home-"));
    tempDirs.push(home);

    const result = await runTokenScenario(home);
    const tokenFile = join(home, ".omms", ".auth-token");

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(tokenFile, "utf-8")).toBe(result.token);
    expect(existsSync(join(home, ".opencode-mem"))).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    }
    expect([result.omms, result.legacy, result.wrong, result.none]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("adopts a legacy opencode-mem token once and leaves the legacy file untouched", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-auth-home-"));
    tempDirs.push(home);
    const legacyFile = join(home, ".opencode-mem", ".auth-token");
    mkdirSync(join(home, ".opencode-mem"), { recursive: true });
    writeFileSync(legacyFile, "legacy-token\n");

    const result = await runTokenScenario(home);

    expect(result.token).toBe("legacy-token");
    expect(readFileSync(join(home, ".omms", ".auth-token"), "utf-8")).toBe("legacy-token");
    expect(readFileSync(legacyFile, "utf-8")).toBe("legacy-token\n");
  });

  it("prefers an existing omms token over the legacy one", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-auth-home-"));
    tempDirs.push(home);
    mkdirSync(join(home, ".opencode-mem"), { recursive: true });
    mkdirSync(join(home, ".omms"), { recursive: true });
    writeFileSync(join(home, ".opencode-mem", ".auth-token"), "legacy-token");
    writeFileSync(join(home, ".omms", ".auth-token"), "omms-token");

    expect((await runTokenScenario(home)).token).toBe("omms-token");
  });
});
