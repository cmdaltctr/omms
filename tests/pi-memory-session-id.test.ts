import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test spawns a Bun process; a Windows runner can take over 5 seconds.
setDefaultTimeout(30_000);

const extensionUrl = new URL("../src/adapters/pi/extension.js", import.meta.url).href;
const operationsUrl = new URL("../src/core/memory-operations.js", import.meta.url).href;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Run the Pi `memory` tool once and return the context it gave the shared operation. */
function contextSeenByOperation(sessionId: string) {
  const dir = mkdtempSync(join(tmpdir(), "pi-memory-session-id-"));
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
const { default: ommsPiExtension } = await import(${JSON.stringify(extensionUrl)});
const tools = [];
ommsPiExtension({
  on: () => {},
  registerTool: (definition) => tools.push(definition),
  registerCommand: () => {},
});
const memory = tools.find((tool) => tool.name === "memory");
await memory.execute(
  "call-1",
  { mode: "memorise", content: "x" },
  undefined,
  undefined,
  { cwd: ${JSON.stringify(dir)}, sessionManager: { getSessionId: () => ${JSON.stringify(sessionId)} } }
);
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
  return { seen: JSON.parse(match[1]!)[0], dir };
}

describe("the Pi memory tool passes the session ID", () => {
  it("maps the session manager's session ID to hostSessionId for host pi", () => {
    const { seen, dir } = contextSeenByOperation("pi_ses_test");
    expect(seen.args.mode).toBe("memorise");
    expect(seen.context.host).toBe("pi");
    expect(seen.context.hostSessionId).toBe("pi_ses_test");
    expect(seen.context.directory).toBe(dir);
  });
});
