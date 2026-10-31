import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The scenario runs the terminal command several times in a child process.
setDefaultTimeout(60_000);

/**
 * `om-memory-system skills record-past` and `skills delete-turns` (task 4.5).
 * The child process gets its own empty home folder, so the default Pi and
 * Claude Code history folders, the config and the store are all temporary.
 */

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, path)).href);

function runScenario(config: Record<string, unknown>, body: string): any {
  const home = mkdtempSync(join(tmpdir(), "skills-record-past-"));
  tempDirs.push(home);
  const script = `
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
const home = ${JSON.stringify(home)};
const project = home + "/project-a";
const claudeProject = home + "/claude-project";
mkdirSync(project, { recursive: true });
mkdirSync(claudeProject, { recursive: true });
mkdirSync(home + "/.config/omms", { recursive: true });
writeFileSync(home + "/.config/omms/omms.jsonc", JSON.stringify({
  skillFolders: [],
  importPathMaps: [{ from: "/tmp/claude-fixture-project", to: claudeProject }],
  ...${JSON.stringify(config)},
}));
const { writeV3Session } = await import(${url("./pi-import-fixtures.js")});
mkdirSync(home + "/.pi/agent/sessions/proj-a", { recursive: true });
writeV3Session({
  file: home + "/.pi/agent/sessions/proj-a/a.jsonl",
  sessionId: "sess-a",
  cwd: project,
  windows: [
    { userText: "First request", assistantText: "First reply", timestamp: "2026-01-01T10:00:00.000Z" },
    { userText: "Second request", assistantText: "Second reply", timestamp: "2026-01-02T10:00:00.000Z" },
  ],
});
cpSync(${JSON.stringify(join(import.meta.dir, "fixtures", "claude-transcripts", "-tmp-claude-fixture-project"))},
  home + "/.claude/projects/-tmp-claude-fixture-project", { recursive: true });

const { runSkillsCommand } = await import(${url("../src/cli/skills-command.js")});
const { tursoConnectionManager } = await import(${url("../src/services/turso/connection-manager.js")});
const skillsDb = home + "/.omms/data/skills.db";
async function counts() {
  if (!existsSync(skillsDb)) return null;
  const db = await tursoConnectionManager.getConnection(skillsDb);
  const n = async (table) => Number((await db.get("SELECT COUNT(*) AS n FROM " + table)).n);
  return { turns: await n("turns"), toolCalls: await n("tool_calls"), hosts: (await db.all("SELECT DISTINCT host FROM turns ORDER BY host")).map((r) => r.host) };
}
async function command(argv) {
  const lines = [];
  const errors = [];
  const code = await runSkillsCommand(argv, (line) => lines.push(line), (line) => errors.push(line));
  return { code, text: lines.join("\\n"), errors: errors.join("\\n") };
}

let scenario;
${body}
console.log("RESULT:" + JSON.stringify(scenario ?? null));
process.exit(0);
`;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_TEST_HOME: home },
  });
  const match = proc.stdout.toString().match(/RESULT:(.*)$/m);
  if (!match) throw new Error(`no result: ${proc.stdout}\n${proc.stderr}`);
  return JSON.parse(match[1]!);
}

describe("skills record-past", () => {
  it("previews, then records every set-up host's turns once, then adds none", () => {
    const out = runScenario(
      { skillLearning: true },
      `
const preview = await command(["record-past"]);
const afterPreview = await counts();
const first = await command(["record-past", "--yes"]);
const afterFirst = await counts();
const second = await command(["record-past", "--yes"]);
scenario = { preview, afterPreview, first, afterFirst, second, afterSecond: await counts() };
`
    );
    expect(out.preview.code).toBe(0);
    expect(out.preview.text).toContain("Pi: 2 to record, 0 already recorded");
    expect(out.preview.text).toContain("Run again with --yes");
    expect(out.afterPreview).toBeNull();

    expect(out.first.code).toBe(0);
    expect(out.first.text).toContain("Pi: 2 recorded, 0 already present");
    expect(out.first.text).toMatch(/Claude Code: [1-9]\d* recorded, 0 already present/);
    expect(out.afterFirst.hosts).toEqual(["claude-code", "pi"]);

    expect(out.second.code).toBe(0);
    expect(out.second.text).toContain("Pi: 0 recorded, 2 already present");
    expect(out.second.text).toMatch(/Claude Code: 0 recorded, [1-9]\d* already present/);
    expect(out.afterSecond).toEqual(out.afterFirst);
  });

  it("records sessions whose project folder is gone, which a memories import still skips", () => {
    const out = runScenario(
      // No map: the Claude Code fixture's folder, /tmp/claude-fixture-project, does not exist.
      { skillLearning: true, importPathMaps: [] },
      `
mkdirSync(home + "/.pi/agent/sessions/gone", { recursive: true });
writeV3Session({
  file: home + "/.pi/agent/sessions/gone/b.jsonl",
  sessionId: "sess-gone",
  cwd: home + "/gone-project",
  windows: [{ userText: "Gone request", assistantText: "Gone reply", timestamp: "2026-01-03T10:00:00.000Z" }],
});
const { parseHistoryImportArgs } = await import(${url("../src/importer/import-args.js")});
const { runHistoryImport } = await import(${url("../src/importer/run-import.js")});
async function memoryPreview(host) {
  const args = parseHistoryImportArgs(["--scope", "all-projects", "--dry-run", "--skip-profile"], { host, surface: "cli" });
  const report = await runHistoryImport(host, args, { cwd: home, models: {}, savedPathMaps: [] });
  return {
    unresolvable: report.unresolvableSessions.map((s) => s.cwd),
    unitSessions: [...new Set(report.units.map((u) => u.sessionId))],
  };
}
const recorded = await command(["record-past", "--yes"]);
const db = await tursoConnectionManager.getConnection(skillsDb);
const rows = await db.all("SELECT DISTINCT host, session_id, project_name FROM turns ORDER BY host, session_id");
scenario = {
  recorded,
  sessions: rows.map((r) => r.host + ":" + r.session_id + ":" + r.project_name),
  pi: await memoryPreview("pi"),
  claude: await memoryPreview("claude-code"),
};
`
    );
    expect(out.recorded.code).toBe(0);
    expect(out.recorded.text).toContain("Pi: 3 recorded, 0 already present");
    expect(out.sessions).toEqual([
      "claude-code:11111111-1111-4111-8111-111111111111:claude-fixture-project",
      "pi:sess-a:project-a",
      "pi:sess-gone:gone-project",
    ]);
    expect(out.pi.unresolvable).toHaveLength(1);
    expect(out.pi.unresolvable[0]).toEndWith("/gone-project");
    expect(out.pi.unitSessions).toEqual(["sess-a"]);
    expect(out.claude).toEqual({
      unresolvable: ["/tmp/claude-fixture-project"],
      unitSessions: [],
    });
  });

  it("refuses to run while skill learning is off", () => {
    const out = runScenario(
      {},
      `scenario = { run: await command(["record-past", "--yes"]), store: await counts() };`
    );
    expect(out.run.code).toBe(1);
    expect(out.run.text).toContain("skillLearning");
    expect(out.store).toBeNull();
  });
});

describe("skills delete-turns", () => {
  it("deletes every recorded turn only with --yes", () => {
    const out = runScenario(
      { skillLearning: true },
      `
await command(["record-past", "--yes"]);
const before = await counts();
const preview = await command(["delete-turns"]);
const afterPreview = await counts();
const deleted = await command(["delete-turns", "--yes"]);
scenario = { before, preview, afterPreview, deleted, after: await counts() };
`
    );
    expect(out.before.turns).toBeGreaterThan(0);
    expect(out.preview.code).toBe(0);
    expect(out.preview.text).toContain(`Recorded turns: ${out.before.turns}`);
    expect(out.afterPreview).toEqual(out.before);
    expect(out.deleted.code).toBe(0);
    expect(out.deleted.text).toContain(`Deleted ${out.before.turns} recorded turns`);
    expect(out.after).toEqual({ turns: 0, toolCalls: 0, hosts: [] });
  });

  it("names an unknown mode", () => {
    const out = runScenario({}, `scenario = await command(["frobnicate"]);`);
    expect(out.code).toBe(1);
    expect(out.text).toContain("Unknown skills mode: frobnicate");
  });
});

/**
 * The shared `skills` operations from a terminal (task 6.2). The body writes
 * one watched skill folder into the config, so each mode reads a real store.
 */
const WATCHED_SKILL = `
const OLD = "---\\nname: s-web-search\\ndescription: Search the web\\n---\\nOld body\\n";
const NEW = "---\\nname: s-web-search\\ndescription: Search the web\\n---\\nNew body\\n";
const skillPath = home + "/skills/s-web-search/SKILL.md";
mkdirSync(home + "/skills/s-web-search", { recursive: true });
writeFileSync(skillPath, OLD);
function useConfig(extra) {
  writeFileSync(home + "/.config/omms/omms.jsonc", JSON.stringify({ skillFolders: [home + "/skills"], ...extra }));
}
async function seedProposal() {
  const { SkillStore, skillsDbPath } = await import(${url("../src/services/skill-learning/store.js")});
  const { createProposal } = await import(${url("../src/services/skill-learning/proposal-store.js")});
  const { hashSkillContent } = await import(${url("../src/services/skill-learning/apply.js")});
  const store = new SkillStore(skillsDbPath(home + "/.omms/data"));
  await store.init();
  return createProposal(store, {
    kind: "improve", skillName: "s-web-search", skillPath, baseHash: hashSkillContent(OLD),
    content: NEW, diff: "-Old body\\n+New body", summary: "Explain the curl failure", evidenceTurnIds: [7],
  }, Date.now());
}
`;

describe("skills operation modes", () => {
  it("lists the watched skills as text, or as JSON with --json", () => {
    const out = runScenario(
      {},
      `${WATCHED_SKILL}
useConfig({ skillLearning: true });
scenario = { text: await command(["list"]), json: await command(["list", "--json"]) };
`
    );
    expect(out.text.code).toBe(0);
    expect(out.text.text).toContain("s-web-search: 0 uses");
    expect(out.json.code).toBe(0);
    const reply = JSON.parse(out.json.text);
    expect(reply).toMatchObject({ success: true, mode: "list", code: "ok" });
    expect(reply.data.skills[0].name).toBe("s-web-search");
  });

  it("accepts --order attention for list and refuses an unknown order", () => {
    const out = runScenario(
      {},
      `${WATCHED_SKILL}
useConfig({ skillLearning: true });
scenario = {
  ok: await command(["list", "--order", "attention", "--json"]),
  bad: await command(["list", "--order", "newest"]),
  help: await command(["list", "--help"]),
};
`
    );
    expect(out.ok.code).toBe(0);
    expect(JSON.parse(out.ok.text).data.skills[0].attention).toBe(0.5);
    expect(out.bad.code).toBe(1);
    expect(out.bad.text + out.bad.errors).toContain("order");
    expect(out.help.text).toContain("--order");
  });

  it("says recording is off, with exit code 1, when skill learning is off", () => {
    const out = runScenario(
      {},
      `${WATCHED_SKILL}
useConfig({});
scenario = { text: await command(["list"]), json: await command(["list", "--json"]) };
`
    );
    expect(out.text.code).toBe(1);
    expect(out.text.text).toContain("Skill learning is off");
    expect(out.json.code).toBe(1);
    expect(JSON.parse(out.json.text)).toMatchObject({ success: false, code: "recording-off" });
  });

  it("shows, applies as the person, and refuses to reject an applied proposal", () => {
    const out = runScenario(
      {},
      `${WATCHED_SKILL}
useConfig({ skillLearning: true });
const proposal = await seedProposal();
const listed = await command(["proposals", "--state", "pending"]);
const shown = await command(["show", "--id", proposal.id]);
const applied = await command(["apply", "--json", "--id=" + proposal.id]);
const { readFileSync } = await import("node:fs");
const file = readFileSync(skillPath, "utf8");
const rejected = await command(["reject", "--id", proposal.id]);
scenario = { id: proposal.id, listed, shown, applied, file, rejected };
`
    );
    expect(out.listed.code).toBe(0);
    expect(out.listed.text).toContain(`${out.id} pending improve s-web-search`);
    expect(out.shown.code).toBe(0);
    expect(out.shown.text).toContain("Summary: Explain the curl failure");
    expect(out.shown.text).toContain("+New body");
    expect(out.applied.code).toBe(0);
    const applied = JSON.parse(out.applied.text);
    expect(applied).toMatchObject({ success: true, code: "applied" });
    expect(applied.data.proposal.appliedBy).toBe("person");
    expect(out.file).toContain("New body");
    expect(out.rejected.code).toBe(1);
    expect(out.rejected.text).toContain("Only a pending proposal can be rejected");
  });

  it("passes the idea flags and the folder to draft", () => {
    const out = runScenario(
      {},
      `${WATCHED_SKILL}
useConfig({ skillLearning: true });
scenario = await command(["draft", "--idea-name", "deploy", "--idea-description", "Deploy steps", "--folder", home + "/elsewhere", "--json"]);
`
    );
    expect(out.code).toBe(1);
    expect(JSON.parse(out.text)).toMatchObject({ mode: "draft", code: "not-watched" });
  });

  it("lists every mode in help and the usage", () => {
    const out = runScenario(
      {},
      `scenario = { help: await command(["help"]), usage: await command(["--help"]) };`
    );
    expect(out.help.code).toBe(0);
    for (const mode of ["list", "ideas", "draft", "proposals", "show", "apply", "reject"]) {
      expect(out.help.text).toContain(`- ${mode}`);
      expect(out.usage.text).toContain(`  ${mode}`);
    }
    expect(out.usage.text).toContain("--json");
  });

  it("sends a bad option to stderr, prints nothing to stdout and exits 1", () => {
    const out = runScenario(
      {},
      `scenario = { unknown: await command(["list", "--colour"]), missing: await command(["show", "--id"]) };`
    );
    expect(out.unknown.code).toBe(1);
    expect(out.unknown.text).toBe("");
    expect(out.unknown.errors).toContain("Unknown option --colour");
    expect(out.missing.code).toBe(1);
    expect(out.missing.text).toBe("");
    expect(out.missing.errors).toContain("--id needs a value");
  });
});
