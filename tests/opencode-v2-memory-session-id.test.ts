import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test spawns a Bun process; a Windows runner can take over 5 seconds.
setDefaultTimeout(30_000);

const pluginUrl = new URL("../src/v2/plugin.js", import.meta.url).href;
const fakeContextUrl = new URL("./fake-v2-context.ts", import.meta.url).href;
const operationsUrl = new URL("../src/core/memory-operations.js", import.meta.url).href;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run the OpenCode V2 `memory` tool once through the V2 plugin's `setup`. The call goes
 * V2 tool -> `executeMemoryOperation` (mocked to record what it receives).
 */
function contextSeenByOperation(toolContext: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "opencode-v2-memory-session-id-"));
  tempDirs.push(dir);
  const home = join(dir, "home");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(join(home, ".config", "omms", "omms.jsonc"), '{ "webServerEnabled": false }');
  const script = `
import { mock } from "bun:test";
const real = await import(${JSON.stringify(operationsUrl)});
const seen = [];
mock.module(${JSON.stringify(operationsUrl)}, () => ({
  ...real,
  executeMemoryOperation: async (args, context) => {
    seen.push({ args, context });
    return { success: true };
  },
}));
globalThis[Symbol.for("omms.plugin.warmedup")] = true;
const { createFakeV2Context } = await import(${JSON.stringify(fakeContextUrl)});
const plugin = (await import(${JSON.stringify(pluginUrl)})).default;
const fake = createFakeV2Context({ directory: ${JSON.stringify(dir)} });
const cleanup = await plugin.setup(fake.ctx);
await fake.runTool("memory", { mode: "memorise", content: "x" }, ${JSON.stringify(toolContext)});
await cleanup();
console.log("SEEN:" + JSON.stringify(seen));
process.exit(0);
`;
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(scriptPath, script, "utf-8");
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    cwd: dir,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_DISABLE_WEB_AUTOSTART: "1",
      OMMS_DISABLE_AUTO_BACKFILL: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8");
  const match = stdout.match(/SEEN:(.*)$/m);
  if (!match) throw new Error(`no result: ${stdout}\n${Buffer.from(result.stderr).toString()}`);
  return JSON.parse(match[1]!)[0];
}

describe("the OpenCode V2 memory tool passes the session ID", () => {
  it("maps the V2 tool context session ID to hostSessionId for host opencode", () => {
    const seen = contextSeenByOperation({
      sessionID: "ses_v2_test",
      messageID: "msg_1",
      agent: "build",
    });
    expect(seen.args.mode).toBe("memorise");
    expect(seen.context.host).toBe("opencode");
    expect(seen.context.hostSessionId).toBe("ses_v2_test");
  });
});
