import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The three automatic triggers end to end (openspec change friendly-settings, ADR-051): the real
 * config loads from a file in a scratch home, the real cleanup service runs on a scratch store,
 * and only the host shell around each trigger is fake. A file written by an older version
 * deletes nothing; `autoDeleteOldMemories: true` deletes exactly the counted memories.
 * Each case runs in its own process, because the once-a-day guard is per process.
 */
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const src = (path: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dir, "../src", path)).href);

// Capture and the web app are off, so no trigger calls a model or starts a server.
const QUIET = { autoCaptureEnabled: false, webServerEnabled: false, autoCleanupRetentionDays: 30 };
const OLD_FILE = { ...QUIET, autoCleanupEnabled: true };
const NEW_FILE = { ...QUIET, autoDeleteOldMemories: true };

const TRIGGERS = {
  "OpenCode idle": `
    const { createOpencodeSessionEvents, IDLE_CAPTURE_DELAY_MS } = await import(${src("v2/session-events.ts")});
    // Skip the 10-second idle wait; every other timer keeps its delay.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...rest) =>
      realSetTimeout(fn, ms === IDLE_CAPTURE_DELAY_MS ? 0 : ms, ...rest);
    const events = createOpencodeSessionEvents({
      session: { get: async () => ({ title: "user session" }) },
      directory: project,
      autoCaptureHost: {},
      learnProfile: async () => {},
    });
    await events.handle({ type: "session.idle", properties: { sessionID: "ses-user" } });
  `,
  "Pi settled turn": `
    const { default: ommsPiExtension } = await import(${src("adapters/pi/extension.ts")});
    const handlers = {};
    ommsPiExtension({
      on: (event, handler) => { handlers[event] = handler; },
      registerTool: () => {},
      registerCommand: () => {},
    });
    await handlers.agent_settled({}, {
      cwd: project, hasUI: false, mode: "print", model: null, modelRegistry: null,
      ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
      sessionManager: { getSessionId: () => "pi-session", getBranch: () => [] },
    });
  `,
  "web app timer": `
    const { startDailyMaintenanceTimer } = await import(${src("services/cleanup-service.ts")});
    stops.push(startDailyMaintenanceTimer(() => CONFIG));
  `,
} as const;

// The Cleanup button on the page. It deletes by age whatever the switch says, after its own confirm.
const MANUAL = `await cleanupService.runCleanup(CONFIG);`;

async function run(trigger: keyof typeof TRIGGERS | "manual", config: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "omms-deletion-paths-"));
  dirs.push(home);
  const project = join(home, "project");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(join(home, ".config", "omms", "omms.jsonc"), JSON.stringify(config, null, 2));
  const script = `
    const { join } = await import("node:path");
    const project = ${JSON.stringify(project)};
    const stops = [];
    const { CONFIG } = await import(${src("config.ts")});
    const { cleanupService } = await import(${src("services/cleanup-service.ts")});
    const { tursoShardManager } = await import(${src("services/turso/shard-manager.ts")});
    const { tursoConnectionManager } = await import(${src("services/turso/connection-manager.ts")});
    const { tursoVectorSearch } = await import(${src("services/turso/vector-search.ts")});
    const { userPromptManager } = await import(${src("services/user-prompt/user-prompt-manager.ts")});
    const { ensureTursoReady } = await import(${src("services/turso/ready.ts")});
    await ensureTursoReady();

    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const scope = "a1b2c3d4e5f60718";
    const shard = await tursoShardManager.createShard("project", scope, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const vector = new Float32Array(CONFIG.embeddingDimensions);
    vector[0] = 1;
    for (const [id, at] of [["old-1", old], ["old-2", old], ["old-3", old], ["pinned-old", old], ["fresh", Date.now()]]) {
      await tursoVectorSearch.insertVector(db, { id, content: id, vector,
        containerTag: "omms_project_" + scope, type: "discussion", createdAt: at, updatedAt: at });
    }
    await tursoVectorSearch.pinMemory(db, "pinned-old");
    const promptId = await userPromptManager.savePrompt("s1", "m1", project, "an old prompt");
    const prompts = await tursoConnectionManager.getConnection(join(CONFIG.storagePath, "user-prompts.db"));
    await prompts.run("UPDATE user_prompts SET created_at = ? WHERE id = ?", [old, promptId]);
    const promptCount = async () =>
      Number((await prompts.get("SELECT COUNT(*) AS n FROM user_prompts")).n);

    const counted = await cleanupService.countCleanupCandidates(CONFIG.autoCleanupRetentionDays);
    const promptsBefore = await promptCount();

    ${trigger === "manual" ? MANUAL : TRIGGERS[trigger]}

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const status = cleanupService.getStatus(CONFIG);
      if (status.lastCleanupTime > 0 && !status.isRunning) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    stops.forEach((stop) => stop());
    const ran = cleanupService.getStatus(CONFIG).lastCleanupTime > 0;
    const left = (await db.all("SELECT id FROM memories ORDER BY id")).map((row) => String(row.id));
    console.log("RESULT:" + JSON.stringify({
      ran, counted, left, deleteOn: CONFIG.autoDeleteOldMemories,
      promptsBefore, promptsAfter: await promptCount(),
    }));
    process.exit(0);
  `;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    cwd: project,
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_LOG_FILE: join(home, "omms.log") },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text + error);
  const logFile = join(home, "omms.log");
  const logText = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  return { ...JSON.parse(match[1]!), logText, project };
}

const DELETION_LINE = "Cleanup: old memories deleted";

/** The one deletion line: counts and days only, never memory text, ids or project names. */
function expectDeletionLine(
  result: { logText: string; project: string },
  expected: { memories: number; prompts: number; retentionDays: number; trigger: string }
) {
  const lines = result.logText.split("\n").filter((line) => line.includes(DELETION_LINE));
  expect(lines).toHaveLength(1);
  const data = JSON.parse(
    lines[0]!.slice(lines[0]!.indexOf(DELETION_LINE) + DELETION_LINE.length + 2)
  );
  expect(data).toEqual(expected);
  // The deleted rows' text and ids, the prompt text, the project tag and the project folder.
  for (const text of [
    "old-1",
    "old-2",
    "old-3",
    "an old prompt",
    "a1b2c3d4e5f60718",
    result.project,
  ]) {
    expect(lines[0]).not.toContain(text);
  }
}

const ALL = ["fresh", "old-1", "old-2", "old-3", "pinned-old"];

describe("automatic deletion paths through the real config and cleanup service", () => {
  for (const trigger of Object.keys(TRIGGERS) as (keyof typeof TRIGGERS)[]) {
    it(`${trigger}: an old file with autoCleanupEnabled true deletes nothing`, async () => {
      const result = await run(trigger, OLD_FILE);
      expect(result.ran).toBe(true);
      expect(result.deleteOn).toBe(false);
      expect(result.counted).toBe(3);
      expect(result.left).toEqual(ALL);
      expect(result.promptsAfter).toBe(result.promptsBefore);
      expect(result.logText).not.toContain(DELETION_LINE);
    });

    it(`${trigger}: autoDeleteOldMemories true deletes exactly the counted memories`, async () => {
      const result = await run(trigger, NEW_FILE);
      expect(result.ran).toBe(true);
      expect(result.deleteOn).toBe(true);
      expect(ALL.length - result.left.length).toBe(result.counted);
      expect(result.left).toEqual(["fresh", "pinned-old"]);
      expect(result.promptsAfter).toBe(result.promptsBefore - 1);
      expectDeletionLine(result, { memories: 3, prompts: 1, retentionDays: 30, trigger: "daily" });
    });
  }

  it("the manual Cleanup button writes the same deletion line", async () => {
    const result = await run("manual", OLD_FILE);
    expect(result.left).toEqual(["fresh", "pinned-old"]);
    expectDeletionLine(result, { memories: 3, prompts: 1, retentionDays: 30, trigger: "manual" });
  });
});
