import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test spawns a Bun process; a Windows runner can take over 5 seconds.
setDefaultTimeout(30_000);

const indexUrl = new URL("../src/index.js", import.meta.url).href;
const adapterUrl = new URL("../src/v2/adapter.js", import.meta.url).href;
const bridgeUrl = new URL("../src/v2/memory-bridge.js", import.meta.url).href;
const operationsUrl = new URL("../src/core/memory-operations.js", import.meta.url).href;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run the OpenCode V2 `memory` tool once. The real V1 plugin is the legacy plugin, so the call
 * goes V2 tool -> `legacy.tool.memory.execute` -> `executeMemoryOperation` (mocked to record).
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
const { OmmsPlugin } = await import(${JSON.stringify(indexUrl)});
const { registerV2Adapter } = await import(${JSON.stringify(adapterUrl)});
const { createV2MemoryBridge } = await import(${JSON.stringify(bridgeUrl)});

const legacy = await OmmsPlugin({
  directory: ${JSON.stringify(dir)},
  worktree: ${JSON.stringify(dir)},
  project: { id: "test-project" },
  serverUrl: new URL("http://localhost:4096"),
  client: {
    path: { get: async () => ({ data: { state: ${JSON.stringify(join(dir, "state"))} } }) },
    provider: { list: async () => ({ data: { connected: [] } }) },
    tui: null,
  },
  $: () => {
    throw new Error("not used in tests");
  },
});

const tools = new Map();
const ctx = {
  location: {
    directory: ${JSON.stringify(dir)},
    project: { id: "test-project", directory: ${JSON.stringify(dir)}, canonical: "test-project" },
  },
  tool: { transform: async (callback) => callback({ add: (tool) => tools.set(tool.name, tool) }) },
  session: {
    hook: async () => {},
    get: async () => ({ location: { directory: ${JSON.stringify(dir)} } }),
    synthetic: async () => {},
    prompt: async () => {},
  },
  event: { subscribe: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }) },
};
await registerV2Adapter(ctx, legacy, createV2MemoryBridge(${JSON.stringify(dir)}));
await tools.get("memory").execute({ mode: "memorise", content: "x" }, ${JSON.stringify(toolContext)});
console.log("SEEN:" + JSON.stringify(seen));
process.exit(0);
`;
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(scriptPath, script, "utf-8");
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    cwd: dir,
    env: { ...process.env, HOME: home, USERPROFILE: home },
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
