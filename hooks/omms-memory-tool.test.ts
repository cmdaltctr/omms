import { describe, expect, test } from "claude-code/testing";

// Run with `claude plugin test` (`bash scripts/test-claude-mod.sh`). `bun test`
// does not run this file: the engine's own test kit supplies `claude-code/testing`.

const FULL = "mcp__omms__memory";
const LAUNCH_FLAG = "--at-least-own-version";
const textOf = (out: any): string => out.result ?? out.deny;
const ok = (stdout: string) => ({
  exitCode: 0,
  stdout,
  stderr: "",
  isStdoutTruncated: false,
  isStderrTruncated: false,
});

type Run = { argv: readonly string[]; cwd?: string; timeoutMs?: number };

/** Starts a session with stand-ins for tool registration and the launcher. */
async function start($: any, on: any, answer: (argv: readonly string[]) => any = () => ok("{}")) {
  const runs: Run[] = [];
  const registered: any[] = [];
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }));
  on("tool.register", (_$: any, e: any) => {
    registered.push(e);
    return { value: { tool: `mcp__omms__${e.name}` } };
  });
  on("process.run", (_$: any, e: any) => {
    runs.push({ argv: e.argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs });
    return { value: answer(e.argv) };
  });
  on("session.cwd", () => ({ value: "/work" }));
  on("tool.call", { tool: "Read" }, () => ({ result: "file text" }));
  await $.session.start({ cwd: "/work", surface: null, isInteractive: false });
  return { runs, registered };
}

/** The `memory ...` part of a launcher run, after `node <root>/bin/omms-launch.mjs --at-least-own-version`. */
function memoryArgs(run: Run): readonly string[] {
  expect(run.argv[0]).toBe("node");
  expect(String(run.argv[1]).endsWith("/bin/omms-launch.mjs")).toBe(true);
  expect(run.argv[2]).toBe(LAUNCH_FLAG);
  return run.argv.slice(3);
}

describe("registration", () => {
  test("registers the memory tool in the prompt from the start, naming the Bash command it replaces", async ($, on) => {
    const { registered } = await start($, on);
    expect(registered.map((r) => r.name)).toEqual(["memory", "skills"]);
    expect(registered[0].isDeferred).toBe(false);
    expect(registered[0].description).toContain("instead of running `om-memory-system memory`");
    expect(registered[0].description).toContain("Bash");
  });

  test("a registration that fails is shown in the transcript and does not stop the session", async ($, on) => {
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }));
    on("tool.register", () => {
      throw new Error("name taken");
    });
    const logged: string[] = [];
    on("ui.log", (_$: any, e: any) => {
      logged.push(e.text);
      return { value: undefined } as any;
    });
    await $.session.start({ cwd: "/work", surface: null, isInteractive: false });
    expect(
      logged.filter((line) => line.includes("could not register the memory tool:"))
    ).toHaveLength(1);
  });
});

describe("calls", () => {
  test("search runs the launcher with the query, limit and scope, in the session folder, with a 60 second limit", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({
      tool: FULL as any,
      mode: "search",
      query: "subagents",
      limit: 5,
      scope: "all-projects",
    });
    expect(runs).toHaveLength(1);
    expect(memoryArgs(runs[0]!)).toEqual([
      "memory",
      "search",
      "--query",
      "subagents",
      "--limit",
      "5",
      "--scope",
      "all-projects",
    ]);
    expect(runs[0]!.cwd).toBe("/work");
    expect(runs[0]!.timeoutMs).toBe(60_000);
  });

  test("the mode defaults to search, and the command's JSON comes back unchanged", async ($, on) => {
    const { runs } = await start($, on, () => ok('{"success":true,"results":[]}\n'));
    const out = await $.tool.call({ tool: FULL as any, query: "julia-1" });
    expect(textOf(out)).toBe('{"success":true,"results":[]}');
    expect(memoryArgs(runs[0]!)).toEqual(["memory", "search", "--query", "julia-1"]);
  });

  test("add passes content, type and tags", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({
      tool: FULL as any,
      mode: "add",
      content: "Use libSQL",
      type: "decision",
      tags: "db,store",
    });
    expect(memoryArgs(runs[0]!)).toEqual([
      "memory",
      "add",
      "--content",
      "Use libSQL",
      "--type",
      "decision",
      "--tags",
      "db,store",
    ]);
  });

  test("forget passes the id", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({ tool: FULL as any, mode: "forget", id: "mem_alpha" });
    expect(memoryArgs(runs[0]!)).toEqual(["memory", "forget", "--id", "mem_alpha"]);
  });

  test("drops a bad limit and an unknown scope instead of passing them on", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({ tool: FULL as any, mode: "list", limit: -3, scope: "../etc" });
    expect(memoryArgs(runs[0]!)).toEqual(["memory", "list"]);
  });

  test("refuses a search with no query, an add with no content and a forget with no id, without running anything", async ($, on) => {
    const { runs } = await start($, on);
    expect(textOf(await $.tool.call({ tool: FULL as any, mode: "search" }))).toBe(
      "search needs a query."
    );
    expect(textOf(await $.tool.call({ tool: FULL as any, mode: "add" }))).toBe(
      "add needs content."
    );
    expect(textOf(await $.tool.call({ tool: FULL as any, mode: "forget" }))).toBe(
      "forget needs an id."
    );
    expect(runs).toHaveLength(0);
  });

  test("refuses modes that move or rewrite whole stores, and lists the allowed modes", async ($, on) => {
    const { runs } = await start($, on);
    for (const mode of ["import", "export", "migrate", "list-shards", "anything"]) {
      const reason = textOf(await $.tool.call({ tool: FULL as any, mode, query: "x" }));
      expect(reason).toContain(`Unknown mode "${mode}"`);
      expect(reason).toContain("search, add, list, profile, forget, help");
    }
    expect(runs).toHaveLength(0);
  });

  test("success false is an error that names the reason", async ($, on) => {
    await start($, on, () => ok('{"success":false,"error":"no store"}'));
    const out = await $.tool.call({ tool: FULL as any, mode: "list" });
    expect(textOf(out)).toBe("memory failed: no store");
  });

  test("a failing launcher comes back as an error the model can read, cut to 500 characters", async ($, on) => {
    await start($, on, () => ({ ...ok(""), exitCode: 1, stderr: "x".repeat(900) }));
    const out = textOf(await $.tool.call({ tool: FULL as any, mode: "list" }));
    expect(out.startsWith("memory failed: ")).toBe(true);
    expect(out).toHaveLength("memory failed: ".length + 500);
  });

  test("a launcher that cannot start is an error, not a crash", async ($, on) => {
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }));
    on("tool.register", (_$: any, e: any) => ({ value: { tool: `mcp__omms__${e.name}` } }));
    on("session.cwd", () => ({ value: "/work" }));
    on("process.run", () => ({ deny: "failed to start: node not found" }));
    await $.session.start({ cwd: "/work", surface: null, isInteractive: false });
    const out = textOf(await $.tool.call({ tool: FULL as any, mode: "list" }));
    expect(out.startsWith("memory failed:")).toBe(true);
    expect(out).toContain("node not found");
  });

  test("leaves every other tool to the engine", async ($, on) => {
    const { runs } = await start($, on);
    const out = await $.tool.call({ tool: "Read", file_path: "/a.md" });
    expect(textOf(out)).toBe("file text");
    expect(runs).toHaveLength(0);
  });
});
