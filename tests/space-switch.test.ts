import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Only the embedding model is stubbed. Every store below is real and runs in the isolated test home.
const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
mock.module("../src/services/embedding.js", () => ({
  embeddingService: embeddingStub,
  EmbeddingService: { getInstance: () => embeddingStub },
  applyEmbeddingTaskPrefix: (_model: string, text: string) => text,
  loadLocalTransformersBackend: async () => null,
}));

const config = await import("../src/config.js");
const { initConfig, refreshConfigIfChanged } = config;
const { memoryClient } = await import("../src/services/client.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { userProfileManager } = await import("../src/services/user-profile/user-profile-manager.js");
const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");
const { aiSessionManager } = await import("../src/services/ai/session/ai-session-manager.js");
const { chatStore } = await import("../src/services/chat/chat-runtime.js");
const { ImportLedger } = await import("../src/importer/ledger.js");
const { createStoredSpace, spaceFiles, switchStoredSpace } =
  await import("../src/services/spaces/registry-store.js");

const omms = join(homedir(), ".omms");
const files = spaceFiles(omms);
const defaultFolder = join(omms, "data");
const TAG = "omms_project_0123456789abcdef";
let project: string;

/** One hash over every file under a folder, so any change to a space's files shows up. */
function folderHash(folder: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (entry.name === ".cache" || entry.name === ".write-locks") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(entry.name).update(readFileSync(path));
    }
  };
  walk(folder);
  return hash.digest("hex");
}

/** Writes one item to every kind of store and returns what each store holds for this label. */
async function writeAll(label: string) {
  const added = await memoryClient.addMemory(`memory ${label}`, TAG, { sessionID: `s-${label}` });
  expect(added.success ? "ok" : added.error).toBe("ok");
  await userPromptManager.savePrompt("session", `m-${label}`, "/p", `prompt ${label}`);
  await aiSessionManager.createSession({
    provider: "openai-chat",
    sessionId: `ai-${label}`,
  } as never);
  const chats = await chatStore(config.CONFIG);
  await chats.createConversation({ title: `chat ${label}`, scopeTag: null });
  await new ImportLedger().begin({
    key: `k-${label}`,
    sessionId: label,
    sourceFile: "f",
    projectHash: "h",
  });
}

async function readAll() {
  const memories = await memoryClient.listMemories(TAG, 100);
  const prompts = await userPromptManager.getUncapturedPromptsForSession("session");
  const chats = await (await chatStore(config.CONFIG)).listConversations();
  const ledger = new ImportLedger();
  const imports = await ledger.countByStatus();
  const ai = await Promise.all(
    ["A", "B"].map((l) => aiSessionManager.getSession(`ai-${l}`, "openai-chat"))
  );
  return {
    ledger: imports["in-progress"] ?? 0,
    aiSessions: ai.filter(Boolean).map((a) => a!.sessionId),
    memories: memories.success ? memories.memories.map((m) => m.summary ?? "") : [],
    prompts: prompts.map((p) => p.content),
    chats: chats.map((c) => c.title),
  };
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-switch-"));
  mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
  writeFileSync(
    join(homedir(), ".config", "omms", "omms.jsonc"),
    JSON.stringify({ embeddingDimensions: 4 })
  );
  initConfig(project);
});
afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(files.registryPath, { force: true });
  rmSync(files.spacesRoot, { recursive: true, force: true });
});

describe("switching the active space in a running process", () => {
  it("keeps each space's data in its own folder", async () => {
    expect(config.CONFIG.storagePath).toBe(defaultFolder);
    await writeAll("A");
    expect((await readAll()).memories.join()).toContain("memory A");

    const space = await createStoredSpace(files, "Experiments");
    await switchStoredSpace(files, space.id);
    refreshConfigIfChanged(project);
    expect(config.CONFIG.storagePath).toBe(join(files.spacesRoot, "experiments"));

    // The first read in the new space sees nothing of A.
    const empty = await readAll();
    expect(empty).toEqual({ ledger: 0, aiSessions: [], memories: [], prompts: [], chats: [] });
    // Every connection to the old folder is closed. skills.db and other global files may stay open.
    const openPaths = [
      ...(
        tursoConnectionManager as unknown as { connections: Map<string, unknown> }
      ).connections.keys(),
    ];
    expect(openPaths.filter((path) => path.startsWith(defaultFolder))).toEqual([]);
    const defaultHashAfterSwitch = folderHash(defaultFolder);

    await writeAll("B");
    const inB = await readAll();
    expect(inB.memories.join()).toContain("memory B");
    expect(inB.memories.join()).not.toContain("memory A");
    expect(inB.prompts).toEqual(["prompt B"]);
    expect(inB.chats).toEqual(["chat B"]);
    expect(inB.ledger).toBe(1);
    expect(inB.aiSessions).toEqual(["ai-B"]);
    // Nothing written in B reached the Default folder.
    expect(folderHash(defaultFolder)).toBe(defaultHashAfterSwitch);

    await switchStoredSpace(files, "default");
    refreshConfigIfChanged(project);
    const backInA = await readAll();
    expect(backInA.memories.join()).toContain("memory A");
    expect(backInA.memories.join()).not.toContain("memory B");
    expect(backInA.prompts).toEqual(["prompt A"]);
    expect(backInA.chats).toEqual(["chat A"]);
    expect(backInA.ledger).toBe(1);
    expect(backInA.aiSessions).toEqual(["ai-A"]);
  });

  it("does not carry profile cold buffers or dedup state into the next space", async () => {
    const profiles = userProfileManager as unknown as {
      coldBuffers: Map<string, unknown>;
      dedupCheckedCache: Set<string>;
      saveColdBuffers(): void;
    };
    profiles.coldBuffers.set("profile-a", {
      preferences: ["likes tea"],
      patterns: [],
      workflows: [],
    });
    profiles.dedupCheckedCache.add("pair-a");
    profiles.saveColdBuffers();

    await switchStoredSpace(files, "experiments");
    refreshConfigIfChanged(project);
    expect(profiles.coldBuffers.size).toBe(0);
    expect(profiles.dedupCheckedCache.size).toBe(0);
    profiles.saveColdBuffers();
    expect(existsSync(join(files.spacesRoot, "experiments", "cold-buffer.json"))).toBe(true);
    expect(readFileSync(join(files.spacesRoot, "experiments", "cold-buffer.json"), "utf-8")).toBe(
      "{}"
    );

    await switchStoredSpace(files, "default");
    refreshConfigIfChanged(project);
    expect([...profiles.coldBuffers.keys()]).toEqual(["profile-a"]);
  });
});
