import { afterEach, describe, expect, it, mock, setDefaultTimeout } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);
const dirs: string[] = [];
afterEach(async () => {
  const { memoryClient } = await import("../src/services/client.js");
  await memoryClient.close();
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  await tursoConnectionManager.closeAll();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
mock.module("../src/services/embedding.js", () => ({
  embeddingService: embeddingStub,
  EmbeddingService: class {
    static getInstance() {
      return embeddingStub;
    }
  },
  applyEmbeddingTaskPrefix: (_model: unknown, text: string) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module("../src/services/turso/ready.js", () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));
mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const structuredCalls: Array<{ providerID: string; modelID: string }> = [];
const connected = new Set(["zai", "other"]);
mock.module("../src/services/ai/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    isProviderConnected: (provider: string) => connected.has(provider),
    getV2Client: () => ({}),
    generateStructuredOutput: async (opts: { providerID: string; modelID: string }) => {
      structuredCalls.push({ providerID: opts.providerID, modelID: opts.modelID });
      return { type: "skip" };
    },
  }),
}));

const { parseHistoryImportArgs, tokenizeImportArgs } =
  await import("../src/importer/import-args.js");
const { runOpencodeImportCommand, OPENCODE_IMPORT_COMMAND } =
  await import("../src/adapters/opencode/import-command.js");

function fixture(options: { internalTitle?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omms-import-cmd-"));
  dirs.push(root);
  const project = join(root, "project");
  mkdirSync(project);
  const dbPath = join(root, "history.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE project (id TEXT, worktree TEXT);
    CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER, title TEXT);
    CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  db.prepare("INSERT INTO project VALUES (?, ?)").run("p", project);
  const session = (id: string, title: string | null, at: number, prompt: string) => {
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      "p",
      null,
      project,
      at,
      title
    );
    for (const [message, role, text, offset] of [
      [`${id}-u`, "user", prompt, 1],
      [`${id}-a`, "assistant", "Done", 2],
    ] as const) {
      db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
        message,
        id,
        at + offset,
        JSON.stringify({ role })
      );
      db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
        `${message}-p`,
        message,
        id,
        at + offset,
        JSON.stringify({ type: "text", text })
      );
    }
  };
  session("real", "Fix importer", 10, "Fix the importer");
  if (options.internalTitle) session("internal", options.internalTitle, 20, "Summarise this");
  db.close();
  return { root, project, dbPath };
}

async function useStore(root: string) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = join(root, "store");
  CONFIG.embeddingDimensions = 4;
  CONFIG.autoCaptureMaxContextBytes = 131072;
}

describe("shared import options", () => {
  it("parses both value styles and quoted paths the same way on every surface", () => {
    const tokens = tokenizeImportArgs(`--map "/old dir=/new dir" --since=2026-01-01 --model zai/x`);
    expect(tokens).toEqual([
      "--map",
      "/old dir=/new dir",
      "--since=2026-01-01",
      "--model",
      "zai/x",
    ]);
    const parsed = parseHistoryImportArgs(tokens, { host: "pi", surface: "session" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.pathMaps).toEqual([{ from: "/old dir", to: "/new dir" }]);
    expect(parsed.model).toBe("zai/x");
  });

  it("keeps API-key flags on the CLI and requires provider/id in a session", () => {
    const session = parseHistoryImportArgs(["--api-key-env", "KEY", "--model", "cheap"], {
      host: "opencode",
      surface: "session",
    });
    expect(session.errors.join(" ")).toContain(
      "--api-key-env is only for the om-memory-system CLI"
    );
    expect(session.errors.join(" ")).toContain("--model must be provider/id");
    const cli = parseHistoryImportArgs(["--api-key-env", "KEY", "--model", "cheap"], {
      host: "opencode",
      surface: "cli",
    });
    expect(cli.errors).toEqual([]);
    expect(cli).toMatchObject({ apiKeyEnv: "KEY", model: "cheap" });
  });

  it("rejects conflicting scope, reversed dates, and another host's source flag", () => {
    const parsed = parseHistoryImportArgs(
      [
        "--scope=all-projects",
        "--project",
        "/x",
        "--since=2026-02-01",
        "--until=2026-01-01",
        "--db=a",
      ],
      { host: "pi", surface: "session" }
    );
    const errors = parsed.errors.join(" ");
    expect(errors).toContain("--project cannot be combined");
    expect(errors).toContain("--since must be before --until");
    expect(errors).toContain('Unknown option: "--db=a"');
  });
});

describe("Pi import model", () => {
  it("uses the session model by default and ignores the live-capture override", async () => {
    const { CONFIG } = await import("../src/config.js");
    const previous = { piProvider: CONFIG.piProvider, piModel: CONFIG.piModel };
    Object.assign(CONFIG, { piProvider: "zai", piModel: "configured" });
    try {
      const { resolveImportModel, resolveModelFromContext } =
        await import("../src/adapters/pi/provider.js");
      const models: Record<string, object> = {
        configured: { provider: "zai", id: "configured" },
        cheap: { provider: "zai", id: "cheap" },
      };
      const ctx = {
        model: { provider: "zai", id: "session" },
        modelRegistry: { find: (_p: string, id: string) => models[id], complete: async () => ({}) },
      };
      expect(resolveImportModel(ctx)?.modelId).toBe("session");
      expect(resolveImportModel(ctx, "zai/cheap")?.modelId).toBe("cheap");
      expect(resolveImportModel(ctx, "zai/missing")).toBeNull();
      expect(resolveModelFromContext(ctx)?.modelId).toBe("configured");
    } finally {
      Object.assign(CONFIG, previous);
    }
  });
});

describe("OpenCode session import command", () => {
  const run = (argsText: string, directory: string, model: object | null = null) => {
    let asked = 0;
    return runOpencodeImportCommand({
      argsText,
      directory,
      sessionModel: async () => {
        asked++;
        return model as never;
      },
    }).then((text) => ({ text, asked }));
  };

  it("uses the session model through OpenCode's sign-in by default", async () => {
    const data = fixture();
    await useStore(data.root);
    structuredCalls.length = 0;
    const { text, asked } = await run(`--db ${data.dbPath} --skip-profile`, data.project, {
      providerID: "zai",
      modelID: "session-model",
    });
    expect(asked).toBe(1);
    expect(text).toContain("model: zai/session-model");
    expect(text).toContain("1 skipped");
    expect(structuredCalls).toEqual([{ providerID: "zai", modelID: "session-model" }]);
  });

  it("uses --model provider/id instead of the session model when given", async () => {
    const data = fixture();
    await useStore(data.root);
    structuredCalls.length = 0;
    const { text, asked } = await run(
      `/${OPENCODE_IMPORT_COMMAND} --db=${data.dbPath} --skip-profile --model other/cheap/v2`,
      data.project,
      { providerID: "zai", modelID: "session-model" }
    );
    expect(asked).toBe(0);
    expect(text).toContain("model: other/cheap/v2");
    expect(structuredCalls).toEqual([{ providerID: "other", modelID: "cheap/v2" }]);
  });

  it("refuses to import without a usable model, but previews without one", async () => {
    const data = fixture();
    await useStore(data.root);
    structuredCalls.length = 0;
    expect((await run(`--db ${data.dbPath}`, data.project)).text).toContain(
      "this session has no model yet"
    );
    expect((await run(`--db ${data.dbPath} --model gone/x`, data.project)).text).toContain(
      'provider "gone" is not connected'
    );
    const preview = await run(`--db ${data.dbPath} --dry-run`, data.project);
    expect(preview.asked).toBe(0);
    expect(preview.text).toContain("memory units: 1 pending");
    expect(structuredCalls).toEqual([]);
    expect((await run("--help", data.project)).text).toContain("--model <provider/id>");
  });

  it("never imports omms's own internal capture sessions", async () => {
    const data = fixture({ internalTitle: "opencode-mem capture" });
    await useStore(data.root);
    const preview = await run(`--db ${data.dbPath} --dry-run`, data.project);
    expect(preview.text).toContain("sessions: 1/1 loaded");
    expect(preview.text).toContain("memory units: 1 pending");
  });
});

describe("V2 command registration", () => {
  it("registers the OpenCode import command and posts its report to the session", async () => {
    const { registerV2Adapter } = await import("../src/v2/adapter.js");
    let command: any;
    const posted: Array<{ sessionID: string; text: string; resume: boolean }> = [];
    const ctx = {
      location: { directory: "/workspace/project", project: { directory: "/workspace/project" } },
      tool: { transform: async (callback: (editor: any) => void) => callback({ add: () => {} }) },
      command: {
        transform: async (callback: (editor: any) => void) =>
          callback({ add: (definition: any) => (command = definition) }),
      },
      session: {
        hook: async () => {},
        get: async () => ({}),
        synthetic: async (input: any) => {
          posted.push(input);
        },
      },
      event: {
        async *subscribe({ signal }: { signal: AbortSignal }) {
          yield* [] as unknown[];
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        },
      },
    } as any;
    const dispose = await registerV2Adapter(ctx, { tool: { memory: {} } }, {} as never);
    expect(command.name).toBe(OPENCODE_IMPORT_COMMAND);
    await command.execute({ sessionID: "s1", prompt: { text: "--help" } });
    expect(posted[0]).toMatchObject({ sessionID: "s1", resume: false });
    expect(posted[0]!.text).toContain("/memory-import-opencode-history");
    await (dispose as any)?.();
  });
});
