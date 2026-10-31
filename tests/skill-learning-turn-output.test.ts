import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Capture every log record so a test can check that no turn text reaches the log.
const logs: Array<{ message: string; data: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => logs.push({ message, data: data ?? null }),
}));

const { recordSkillTurn } = await import("../src/services/skill-learning/turn-output.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { CONFIG } = await import("../src/config.js");

let baseDir: string;
let projectDir: string;

const API_KEY = "sk-ant-abcdefghij0123456789";

function settings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    redact: true,
    folders: [] as string[],
    storagePath: baseDir,
    secrets: {},
    ...overrides,
  };
}

function unit(overrides: Record<string, unknown> = {}) {
  return {
    host: "pi" as const,
    hostSessionId: "s1",
    sourceType: "live-capture" as const,
    projectDirectory: projectDir,
    userPrompt: "Search the web for skills",
    promptId: "u1",
    prompt: { id: "u1", providerId: "anthropic", modelId: "claude" },
    textResponses: ["First reply", "Second reply"],
    toolCalls: [
      { name: "Read", input: 'file_path: "/a.md"', outcome: "ok" as const },
      {
        name: "Bash",
        input: `command: "curl -H 'x-api-key: ${API_KEY}'"`,
        outcome: "error" as const,
        error: "exit 1",
      },
    ],
    sourceTimestamp: 1_000,
    ...overrides,
  };
}

async function rows() {
  const db = await tursoConnectionManager.getConnection(join(baseDir, "skills.db"));
  return {
    turns: await db.all("SELECT * FROM turns ORDER BY id"),
    calls: await db.all("SELECT * FROM tool_calls ORDER BY turn_id, position"),
    uses: await db.all("SELECT * FROM skill_uses ORDER BY id"),
  };
}

describe("recordSkillTurn", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-turn-output-"));
    projectDir = mkdtempSync(join(tmpdir(), "skill-turn-project-"));
    // The connection manager only opens files inside the storage path.
    CONFIG.storagePath = baseDir;
    logs.length = 0;
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
    await cleanupTursoTestDirectory(projectDir);
  });

  it("writes nothing and creates no file when recording is off", async () => {
    const status = await recordSkillTurn(unit(), settings({ enabled: false }));
    expect(status).toBe("disabled");
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
  });

  it("stores the full turn with its key, outcomes and model", async () => {
    const status = await recordSkillTurn(unit(), settings());
    expect(status).toBe("new");
    const { turns, calls } = await rows();
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      turn_key: "pi:s1:u1",
      host: "pi",
      session_id: "s1",
      provider: "anthropic",
      model: "claude",
      created_at: 1_000,
      prompt: "Search the web for skills",
      redacted: 1,
    });
    expect(String(turns[0]!.project_tag)).not.toBe("");
    expect(JSON.parse(String(turns[0]!.replies_json))).toEqual(["First reply", "Second reply"]);
    expect(calls.map((call) => [call.name, call.outcome, call.error])).toEqual([
      ["Read", "ok", null],
      ["Bash", "error", "exit 1"],
    ]);
  });

  it("does not record a fully private prompt when redaction is on", async () => {
    const status = await recordSkillTurn(
      unit({ userPrompt: "<private>all of it</private>" }),
      settings()
    );
    expect(status).toBe("private");
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
  });

  it("redacts an API key in a tool input and private text in replies", async () => {
    await recordSkillTurn(
      unit({ textResponses: ["Done <private>hidden note</private>"] }),
      settings()
    );
    const { turns, calls } = await rows();
    expect(String(calls[1]!.input)).not.toContain(API_KEY);
    expect(String(calls[1]!.input)).toContain("[REDACTED]");
    expect(String(turns[0]!.replies_json)).not.toContain("hidden note");
  });

  it("stores text as written when redaction is off", async () => {
    await recordSkillTurn(
      unit({ textResponses: ["Keep <private>note</private> here"] }),
      settings({ redact: false })
    );
    const { turns, calls } = await rows();
    expect(JSON.parse(String(turns[0]!.replies_json))).toEqual([
      "Keep <private>note</private> here",
    ]);
    expect(String(calls[1]!.input)).toContain(API_KEY);
    expect(turns[0]!.redacted).toBe(0);
  });

  it("keeps one row when the same turn is recorded twice", async () => {
    expect(await recordSkillTurn(unit(), settings())).toBe("new");
    expect(await recordSkillTurn(unit(), settings())).toBe("duplicate");
    const { turns, calls } = await rows();
    expect(turns).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("detects skill use from the unredacted path", async () => {
    const folder = join(baseDir, "skills");
    mkdirSync(join(folder, "s-web-search"), { recursive: true });
    const skillFile = join(folder, "s-web-search", "SKILL.md");
    writeFileSync(skillFile, "---\nname: s-web-search\ndescription: Search\n---\n");
    await recordSkillTurn(
      unit({
        toolCalls: [
          { name: "read", input: 'path: "cut"', outcome: "ok", path: skillFile },
          { name: "Skill", input: 'skill: "s-web-search"', outcome: "ok" },
        ],
      }),
      settings({ folders: [folder] })
    );
    const { uses } = await rows();
    expect(uses.map((use) => [use.skill_name, use.method])).toEqual([
      ["s-web-search", "read"],
      ["s-web-search", "tool"],
    ]);
  });

  it("logs counts and sizes only, never turn text", async () => {
    await recordSkillTurn(unit(), settings());
    await recordSkillTurn(unit(), settings());
    const records = logs.filter((entry) => entry.message.startsWith("Skill turn"));
    expect(records).toHaveLength(2);
    expect(records[0]!.data).toMatchObject({ host: "pi", toolCalls: 2, result: "new" });
    expect(records[1]!.data).toMatchObject({ result: "duplicate" });
    expect(typeof (records[0]!.data as { chars: unknown }).chars).toBe("number");
    const text = JSON.stringify(logs);
    for (const fragment of ["Search the web", "First reply", "curl", "exit 1", API_KEY]) {
      expect(text).not.toContain(fragment);
    }
  });
});
