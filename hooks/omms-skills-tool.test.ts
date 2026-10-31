import { describe, expect, test } from "claude-code/testing";

// Run with `claude plugin test` (`bash scripts/test-claude-mod.sh`). `bun test`
// does not run this file: the engine's own test kit supplies `claude-code/testing`.

const FULL = "mcp__omms__skills";
const LAUNCH_FLAG = "--at-least-own-version";
const textOf = (out: any): string => out.result ?? out.deny;
const ok = (stdout: string) => ({
  exitCode: 0,
  stdout,
  stderr: "",
  isStdoutTruncated: false,
  isStderrTruncated: false,
});

type Run = { argv: readonly string[]; cwd?: string; timeoutMs?: number; stdin?: string };

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
    runs.push({
      argv: e.argv,
      cwd: e.init?.cwd,
      timeoutMs: e.init?.timeoutMs,
      stdin: e.init?.stdin,
    });
    return { value: answer(e.argv) };
  });
  on("session.cwd", () => ({ value: "/work" }));
  on("tool.call", { tool: "Read" }, () => ({ result: "file text" }));
  await $.session.start({ cwd: "/work", surface: null, isInteractive: false });
  return { runs, registered };
}

/**
 * The `skills ...` part of a launcher run, after `node <root>/bin/omms-launch.mjs --at-least-own-version`
 * and before the closing `--directory /work`. The launcher's npx fallback runs from the temp folder,
 * so every call names the session folder.
 */
function skillsArgs(run: Run): readonly string[] {
  expect(run.argv[0]).toBe("node");
  expect(String(run.argv[1]).endsWith("/bin/omms-launch.mjs")).toBe(true);
  expect(run.argv[2]).toBe(LAUNCH_FLAG);
  expect(run.argv.slice(-2)).toEqual(["--directory", "/work"]);
  return run.argv.slice(3, -2);
}

describe("registration", () => {
  test("registers the skills tool in the prompt from the start, naming the Bash command it replaces", async ($, on) => {
    const { registered } = await start($, on);
    const skills = registered.find((r) => r.name === "skills");
    expect(skills).toBeDefined();
    expect(skills.isDeferred).toBe(false);
    expect(skills.description).toContain("instead of running `om-memory-system skills`");
    expect(skills.description).toContain("ranked by use");
    expect(skills.description).toContain("only when the user asks");
    expect(skills.inputSchema.properties.mode.enum).toEqual([
      "list",
      "ideas",
      "draft",
      "evidence",
      "propose",
      "proposals",
      "show",
      "apply",
      "reject",
      "undo",
      "help",
    ]);
    // The agent path: evidence, then propose, with no external API call.
    expect(skills.description).toContain('"evidence"');
    expect(skills.description).toContain('"propose"');
    expect(skills.description).toContain("no external API call");
  });

  test("a failed skills registration is shown in the transcript and does not stop the session", async ($, on) => {
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }));
    on("tool.register", (_$: any, e: any) => {
      if (e.name === "skills") throw new Error("name taken");
      return { value: { tool: `mcp__omms__${e.name}` } };
    });
    const logged: string[] = [];
    on("ui.log", (_$: any, e: any) => {
      logged.push(e.text);
      return { value: undefined } as any;
    });
    await $.session.start({ cwd: "/work", surface: null, isInteractive: false });
    // Only the skills line: the memory tool still registers.
    expect(logged).toHaveLength(1);
    expect(logged[0]!.startsWith("could not register the skills tool:")).toBe(true);
  });
});

describe("calls", () => {
  test("list runs the launcher with --json, in the session folder, with a 60 second limit", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({ tool: FULL as any, mode: "list" });
    expect(runs).toHaveLength(1);
    expect(skillsArgs(runs[0]!)).toEqual(["skills", "list", "--json"]);
    expect(runs[0]!.cwd).toBe("/work");
    expect(runs[0]!.timeoutMs).toBe(60_000);
  });

  test("the mode defaults to help, and the command's JSON comes back unchanged", async ($, on) => {
    const { runs } = await start($, on, () => ok('{"success":true,"mode":"help"}\n'));
    const out = await $.tool.call({ tool: FULL as any });
    expect(textOf(out)).toBe('{"success":true,"mode":"help"}');
    expect(skillsArgs(runs[0]!)).toEqual(["skills", "help", "--json"]);
  });

  test("draft passes the skill, or the idea and the folder", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({ tool: FULL as any, mode: "draft", skill: "s-web-search" });
    await $.tool.call({
      tool: FULL as any,
      mode: "draft",
      idea: { name: "deploy", description: "Deploy steps" },
      folder: "/skills",
    });
    expect(skillsArgs(runs[0]!)).toEqual(["skills", "draft", "--skill", "s-web-search", "--json"]);
    expect(skillsArgs(runs[1]!)).toEqual([
      "skills",
      "draft",
      "--idea-name",
      "deploy",
      "--idea-description",
      "Deploy steps",
      "--folder",
      "/skills",
      "--json",
    ]);
  });

  test("draft keeps the reason and evidence turns of an idea from ideas", async ($, on) => {
    const { runs, registered } = await start($, on);
    const idea = registered.find((r) => r.name === "skills").inputSchema.properties.idea;
    expect(Object.keys(idea.properties).sort()).toEqual([
      "description",
      "evidenceTurnIds",
      "name",
      "reason",
    ]);
    await $.tool.call({
      tool: FULL as any,
      mode: "draft",
      idea: {
        name: "deploy",
        description: "Deploy steps",
        reason: "Seen in three sessions",
        evidenceTurnIds: [12, 14],
      },
      folder: "/skills",
    });
    expect(skillsArgs(runs[0]!)).toEqual([
      "skills",
      "draft",
      "--idea-name",
      "deploy",
      "--idea-description",
      "Deploy steps",
      "--idea-reason",
      "Seen in three sessions",
      "--idea-evidence",
      "12,14",
      "--folder",
      "/skills",
      "--json",
    ]);
  });

  test("ideas and draft wait three minutes, since they also wait for the model", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({ tool: FULL as any, mode: "ideas" });
    await $.tool.call({ tool: FULL as any, mode: "draft", skill: "s-web-search" });
    expect(runs.map((run) => run.timeoutMs)).toEqual([180_000, 180_000]);
  });

  test("list passes the order", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({ tool: FULL as any, mode: "list", order: "attention" });
    expect(runs.map(skillsArgs)).toEqual([["skills", "list", "--order", "attention", "--json"]]);
  });

  test("proposals passes the state, and show, apply, reject and undo pass the id", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({ tool: FULL as any, mode: "proposals", state: "pending" });
    for (const mode of ["show", "apply", "reject", "undo"]) {
      await $.tool.call({ tool: FULL as any, mode, id: "p-1" });
    }
    expect(runs.map(skillsArgs)).toEqual([
      ["skills", "proposals", "--state", "pending", "--json"],
      ["skills", "show", "--id", "p-1", "--json"],
      // The agent applied it, so the command records agent.
      ["skills", "apply", "--id", "p-1", "--applied-by", "agent", "--json"],
      ["skills", "reject", "--id", "p-1", "--json"],
      ["skills", "undo", "--id", "p-1", "--json"],
    ]);
  });

  test("evidence passes the skill and the limit", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({ tool: FULL as any, mode: "evidence", skill: "s-web-search", limit: 5 });
    expect(runs.map(skillsArgs)).toEqual([
      ["skills", "evidence", "--skill", "s-web-search", "--limit", "5", "--json"],
    ]);
  });

  test("propose sends the content on standard input, with the summary and evidence", async ($, on) => {
    const { runs } = await start($, on);
    await $.tool.call({
      tool: FULL as any,
      mode: "propose",
      skill: "s-web-search",
      content: "---\nname: s-web-search\n---\nNew\n",
      summary: "Explain the failure",
      evidence: [12, "T14"],
    });
    await $.tool.call({
      tool: FULL as any,
      mode: "propose",
      idea: { name: "deploy", description: "Deploy steps" },
      folder: "/skills",
      content: "x",
      summary: "New skill",
    });
    const args = runs.map(skillsArgs);
    expect(args[0]).toEqual([
      "skills",
      "propose",
      "--skill",
      "s-web-search",
      "--summary",
      "Explain the failure",
      "--evidence",
      "12,14",
      "--content-file",
      "-",
      "--json",
    ]);
    expect(runs[0]!.stdin).toBe("---\nname: s-web-search\n---\nNew\n");
    expect(args[1]).toEqual([
      "skills",
      "propose",
      "--idea-name",
      "deploy",
      "--idea-description",
      "Deploy steps",
      "--folder",
      "/skills",
      "--summary",
      "New skill",
      "--content-file",
      "-",
      "--json",
    ]);
    expect(runs[1]!.stdin).toBe("x");
  });

  test("refuses propose with no content or nothing to propose for, and undo with no id", async ($, on) => {
    const { runs } = await start($, on);
    expect(
      textOf(await $.tool.call({ tool: FULL as any, mode: "propose", skill: "s-web-search" }))
    ).toBe("propose needs content.");
    expect(textOf(await $.tool.call({ tool: FULL as any, mode: "propose", content: "x" }))).toBe(
      "propose needs a skill or an idea."
    );
    expect(textOf(await $.tool.call({ tool: FULL as any, mode: "evidence" }))).toBe(
      "evidence needs a skill."
    );
    expect(textOf(await $.tool.call({ tool: FULL as any, mode: "undo" }))).toBe(
      "undo needs an id."
    );
    expect(runs).toHaveLength(0);
  });

  test("refuses show, apply and reject with no id, and draft with nothing to draft, without running anything", async ($, on) => {
    const { runs } = await start($, on);
    for (const mode of ["show", "apply", "reject"]) {
      expect(textOf(await $.tool.call({ tool: FULL as any, mode }))).toBe(`${mode} needs an id.`);
    }
    expect(textOf(await $.tool.call({ tool: FULL as any, mode: "draft" }))).toBe(
      "draft needs a skill or an idea."
    );
    expect(runs).toHaveLength(0);
  });

  test("refuses the terminal-only modes and lists the allowed modes", async ($, on) => {
    const { runs } = await start($, on);
    for (const mode of ["record-past", "delete-turns", "anything"]) {
      const reason = textOf(await $.tool.call({ tool: FULL as any, mode }));
      expect(reason).toContain(`Unknown mode "${mode}"`);
      expect(reason).toContain(
        "list, ideas, draft, evidence, propose, proposals, show, apply, reject, undo, help"
      );
    }
    expect(runs).toHaveLength(0);
  });

  test("success false is an error that gives the command's text", async ($, on) => {
    await start($, on, () => ({
      ...ok('{"success":false,"code":"recording-off","text":"Skill learning is off."}'),
      exitCode: 1,
    }));
    const out = await $.tool.call({ tool: FULL as any, mode: "list" });
    expect(textOf(out)).toBe("skills failed: Skill learning is off.");
  });

  test("a failing launcher comes back as an error the model can read, cut to 500 characters", async ($, on) => {
    await start($, on, () => ({ ...ok(""), exitCode: 1, stderr: "x".repeat(900) }));
    const out = textOf(await $.tool.call({ tool: FULL as any, mode: "list" }));
    expect(out.startsWith("skills failed: ")).toBe(true);
    expect(out).toHaveLength("skills failed: ".length + 500);
  });

  test("a launcher that cannot start is an error, not a crash", async ($, on) => {
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }));
    on("tool.register", (_$: any, e: any) => ({ value: { tool: `mcp__omms__${e.name}` } }));
    on("session.cwd", () => ({ value: "/work" }));
    on("process.run", () => ({ deny: "failed to start: node not found" }));
    await $.session.start({ cwd: "/work", surface: null, isInteractive: false });
    const out = textOf(await $.tool.call({ tool: FULL as any, mode: "list" }));
    expect(out.startsWith("skills failed:")).toBe(true);
    expect(out).toContain("node not found");
  });

  test("leaves every other tool to the engine", async ($, on) => {
    const { runs } = await start($, on);
    const out = await $.tool.call({ tool: "Read", file_path: "/a.md" });
    expect(textOf(out)).toBe("file text");
    expect(runs).toHaveLength(0);
  });
});
