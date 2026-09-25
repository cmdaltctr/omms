import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { importProfileFromHistory } from "../src/importer/profile-import.js";

const json = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "omms-profile-import-"));
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "test@example.invalid"],
    ["config", "user.name", "Test User"],
  ]) {
    const result = spawnSync("git", args, { cwd: directory });
    if (result.status !== 0) throw new Error(result.stderr.toString());
  }
  const rows: Array<{ id: string; content: string; captured: boolean; analysed: boolean }> = [];
  const ledgerRows = new Map<string, { status: string }>();
  const ledger = {
    get: async (key: string) => ledgerRows.get(key) ?? null,
    begin: async ({ key }: { key: string }) => {
      ledgerRows.set(key, { status: "in-progress" });
    },
    complete: async (key: string) => {
      ledgerRows.set(key, { status: "imported" });
    },
  };
  const promptStore = {
    savePrompt: async (_session: string, id: string, _dir: string, content: string) => {
      let row = rows.find((entry) => entry.id === id);
      if (!row) {
        row = { id, content, captured: false, analysed: false };
        rows.push(row);
      }
      return row.id;
    },
    markAsCaptured: async (id: string) => {
      rows.find((row) => row.id === id)!.captured = true;
    },
    countUnanalyzedForUserLearning: async () => rows.filter((row) => !row.analysed).length,
    getPromptsForUserLearning: async (limit: number) =>
      rows.filter((row) => !row.analysed).slice(0, limit),
    markMultipleAsUserLearningCaptured: async (ids: string[]) => {
      for (const row of rows) if (ids.includes(row.id)) row.analysed = true;
    },
  };
  let profile: { id: string; profileData: string } | null = null;
  let creations = 0;
  let updates = 0;
  const profileStore = {
    getActiveProfile: async () => profile,
    createProfile: async (
      _id: string,
      _display: string,
      _name: string,
      _email: string,
      data: unknown
    ) => {
      creations++;
      profile = { id: "profile-1", profileData: JSON.stringify(data) };
      return profile.id;
    },
    updateProfile: async (_id: string, data: unknown) => {
      updates++;
      profile = { id: "profile-1", profileData: JSON.stringify(data) };
      return true;
    },
  };
  let modelCalls = 0;
  let fail = false;
  const model = {
    provider: "test",
    modelId: "small",
    complete: async () => {
      modelCalls++;
      if (fail) throw new Error("offline");
      return json;
    },
  };
  const source = [
    {
      sessionId: "s",
      directory,
      sourceFile: "history.db",
      units: [
        {
          userEntryId: "u",
          userPrompt: "Improve the tests",
          sourceEntryIds: ["a"],
          textResponses: ["Updated tests"],
          toolCalls: [],
        },
      ],
    },
  ];
  const options = { host: "opencode" as const, ledger, promptStore, profileStore, model };
  return {
    directory,
    rows,
    ledgerRows,
    source,
    options,
    modelCalls: () => modelCalls,
    creations: () => creations,
    updates: () => updates,
    setFail: (value: boolean) => {
      fail = value;
    },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

it("creates a profile, marks prompts captured, and deduplicates a rerun", async () => {
  const state = setup();
  try {
    const first = await importProfileFromHistory(state.source, state.options as never);
    expect(first.promptsRecorded).toBe(1);
    expect(first.batchesBuilt).toBe(1);
    expect(state.creations()).toBe(1);
    expect(state.rows[0]?.captured).toBe(true);
    expect(state.rows[0]?.analysed).toBe(true);
    expect(state.ledgerRows.get("opencode:s:u:a#profile")?.status).toBe("imported");
    const second = await importProfileFromHistory(state.source, state.options as never);
    expect(second.promptsAlreadyHandled).toBe(1);
    expect(state.rows).toHaveLength(1);
    expect(state.modelCalls()).toBe(1);
  } finally {
    state.cleanup();
  }
});

it("updates an existing profile when another prompt arrives", async () => {
  const state = setup();
  try {
    await importProfileFromHistory(state.source, state.options as never);
    state.source[0]!.units.push({
      ...state.source[0]!.units[0]!,
      userEntryId: "u2",
      sourceEntryIds: ["a2"],
      userPrompt: "Update this",
    });
    const result = await importProfileFromHistory(state.source, state.options as never);
    expect(result.promptsRecorded).toBe(1);
    expect(state.updates()).toBe(1);
  } finally {
    state.cleanup();
  }
});

it("stops after two failed batch attempts and reports the remaining count", async () => {
  const state = setup();
  try {
    state.setFail(true);
    const result = await importProfileFromHistory(state.source, state.options as never);
    expect(result.error).toBe("offline");
    expect(result.remaining).toBe(1);
    expect(state.modelCalls()).toBe(2);
    expect(state.rows[0]?.analysed).toBe(false);
  } finally {
    state.cleanup();
  }
});

it("dry-run never touches stores or the model", async () => {
  const state = setup();
  try {
    const result = await importProfileFromHistory(state.source, {
      ...state.options,
      dryRun: true,
      model: undefined,
      ledger: {
        get: async () => {
          throw new Error("ledger touched");
        },
      },
      promptStore: {
        savePrompt: async () => {
          throw new Error("prompt store touched");
        },
      },
    } as never);
    expect(result.promptsWouldRecord).toBe(1);
    expect(state.rows).toHaveLength(0);
    expect(state.modelCalls()).toBe(0);
  } finally {
    state.cleanup();
  }
});
