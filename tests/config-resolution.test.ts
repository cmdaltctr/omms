import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { initConfig, CONFIG, validateGlobalConfig } from "../src/config.js";

describe("project-scoped config resolution", () => {
  let readSpy: ReturnType<typeof spyOn>;
  let existsSpy: ReturnType<typeof spyOn>;

  const normalizePath = (p: unknown) => String(p).replace(/\\/g, "/");

  afterEach(() => {
    readSpy?.mockRestore();
    existsSpy?.mockRestore();
    // Reset to global-only config
    initConfig("/nonexistent-project");
  });

  it("uses global config when no project config exists", () => {
    existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const path = normalizePath(p);
      return path.includes(".config/opencode/opencode-mem");
    });
    readSpy = spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ opencodeModel: "global-model" })
    );
    initConfig("/some/project");
    expect(CONFIG.opencodeModel).toBe("global-model");
  });

  it("project config overrides global config", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) {
        return JSON.stringify({
          opencodeProvider: "openai",
          opencodeModel: "project-model",
        }) as any;
      }
      return JSON.stringify({
        opencodeProvider: "anthropic",
        opencodeModel: "global-model",
      }) as any;
    });
    initConfig("/my/project");
    expect(CONFIG.opencodeProvider).toBe("openai");
    expect(CONFIG.opencodeModel).toBe("project-model");
  });

  it("keeps automatic cleanup policy under global configuration", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) {
        return JSON.stringify({
          opencodeModel: "project-model",
          autoCleanupEnabled: true,
          autoCleanupRetentionDays: 0,
        }) as any;
      }
      return JSON.stringify({
        opencodeModel: "global-model",
        autoCleanupEnabled: false,
        autoCleanupRetentionDays: 90,
      }) as any;
    });

    initConfig("/my/project");

    expect(CONFIG.opencodeModel).toBe("project-model");
    expect(CONFIG.autoCleanupEnabled).toBe(false);
    expect(CONFIG.autoCleanupRetentionDays).toBe(90);
  });

  it("uses safe cleanup defaults when only project cleanup settings exist", () => {
    existsSpy = spyOn(fs, "existsSync").mockImplementation((p) =>
      normalizePath(p).includes("/my/project/.opencode/opencode-mem")
    );
    readSpy = spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        autoCleanupEnabled: true,
        autoCleanupRetentionDays: -1,
      })
    );

    initConfig("/my/project");

    expect(CONFIG.autoCleanupEnabled).toBe(true);
    expect(CONFIG.autoCleanupRetentionDays).toBe(30);
  });

  it("rejects project embedding transport settings before they can inherit secrets", () => {
    const oldOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "ambient-secret";
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) {
        return JSON.stringify({
          embeddingApiUrl: "https://attacker.example/v1",
        }) as any;
      }
      return JSON.stringify({ embeddingModel: "global-model" }) as any;
    });

    try {
      expect(() => initConfig("/my/project")).toThrow(
        "Project config cannot set remote provider fields: embeddingApiUrl"
      );
    } finally {
      if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldOpenAiKey;
    }
  });

  it("rejects project memory provider settings before they can reuse a global key", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) {
        return JSON.stringify({
          memoryProvider: "orcarouter",
          memoryApiUrl: "https://attacker.example/v1",
        }) as any;
      }
      return JSON.stringify({ memoryApiKey: "global-secret" }) as any;
    });

    expect(() => initConfig("/my/project")).toThrow(
      "Project config cannot set remote provider fields: memoryProvider, memoryApiUrl"
    );
  });

  it("keeps global remote providers and ordinary project overrides working", () => {
    const oldEmbeddingKey = process.env.TEST_EMBEDDING_KEY;
    const oldMemoryKey = process.env.TEST_MEMORY_KEY;
    process.env.TEST_EMBEDDING_KEY = "global-embedding-secret";
    process.env.TEST_MEMORY_KEY = "global-memory-secret";
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) {
        return JSON.stringify({ opencodeModel: "project-model" }) as any;
      }
      return JSON.stringify({
        embeddingApiUrl: "https://trusted-embeddings.example/v1",
        embeddingApiKey: "env://TEST_EMBEDDING_KEY",
        memoryProvider: "openai-chat",
        memoryApiUrl: "https://trusted-memory.example/v1",
        memoryApiKey: "env://TEST_MEMORY_KEY",
      }) as any;
    });

    try {
      initConfig("/my/project");
      expect(CONFIG.opencodeModel).toBe("project-model");
      expect(CONFIG.embeddingApiUrl).toBe("https://trusted-embeddings.example/v1");
      expect(CONFIG.embeddingApiKey).toBe("global-embedding-secret");
      expect(CONFIG.memoryProvider).toBe("openai-chat");
      expect(CONFIG.memoryApiUrl).toBe("https://trusted-memory.example/v1");
      expect(CONFIG.memoryApiKey).toBe("global-memory-secret");
    } finally {
      if (oldEmbeddingKey === undefined) delete process.env.TEST_EMBEDDING_KEY;
      else process.env.TEST_EMBEDDING_KEY = oldEmbeddingKey;
      if (oldMemoryKey === undefined) delete process.env.TEST_MEMORY_KEY;
      else process.env.TEST_MEMORY_KEY = oldMemoryKey;
    }
  });

  it("shallow merge: project adds fields, global fields preserved when not overridden", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) {
        return JSON.stringify({ opencodeProvider: "anthropic" }) as any;
      }
      return JSON.stringify({ opencodeModel: "claude-haiku", autoCaptureEnabled: false }) as any;
    });
    initConfig("/my/project");
    expect(CONFIG.opencodeProvider).toBe("anthropic");
    expect(CONFIG.opencodeModel).toBe("claude-haiku");
    expect(CONFIG.autoCaptureEnabled).toBe(false);
  });

  function mockGlobalAndProject(global: object, project: object) {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) return JSON.stringify(project) as any;
      return JSON.stringify(global) as any;
    });
  }

  it("defaults capture tracing to off with a 7-day retention", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    expect(CONFIG.captureTrace).toBe(false);
    expect(CONFIG.captureTraceRetentionDays).toBe(7);
  });

  it("lets a project turn capture tracing off", () => {
    mockGlobalAndProject({ captureTrace: true }, { captureTrace: false });
    initConfig("/my/project");
    expect(CONFIG.captureTrace).toBe(false);
  });

  it("ignores a project that tries to turn capture tracing on", () => {
    mockGlobalAndProject({}, { captureTrace: true, captureTraceRetentionDays: 365 });
    initConfig("/my/project");
    expect(CONFIG.captureTrace).toBe(false);
    expect(CONFIG.captureTraceRetentionDays).toBe(7);
  });

  it("keeps global capture tracing when the project leaves it unset", () => {
    mockGlobalAndProject({ captureTrace: true, captureTraceRetentionDays: 0 }, {});
    initConfig("/my/project");
    expect(CONFIG.captureTrace).toBe(true);
    expect(CONFIG.captureTraceRetentionDays).toBe(1);
  });

  it("ignores a project value for capture retry retention", () => {
    mockGlobalAndProject({ captureRetryRetentionHours: 12 }, { captureRetryRetentionHours: 720 });
    initConfig("/my/project");
    expect(CONFIG.captureRetryRetentionHours).toBe(12);
  });

  it("turns the capture retry queue off with a global value of 0", () => {
    mockGlobalAndProject({ captureRetryRetentionHours: 0 }, {});
    initConfig("/my/project");
    expect(CONFIG.captureRetryRetentionHours).toBe(0);
  });

  it("loads claudeConfigDir from the global file and expands ~/", () => {
    mockGlobalAndProject({ claudeConfigDir: "/data/claude" }, {});
    initConfig("/my/project");
    expect(CONFIG.claudeConfigDir).toBe("/data/claude");
    readSpy.mockRestore();
    existsSpy.mockRestore();
    mockGlobalAndProject({ claudeConfigDir: "~/work/claude" }, {});
    initConfig("/my/project");
    expect(CONFIG.claudeConfigDir).toBe(join(homedir(), "work", "claude"));
  });

  it("ignores a project value for claudeConfigDir", () => {
    mockGlobalAndProject({ claudeConfigDir: "/data/claude" }, { claudeConfigDir: "/evil/claude" });
    initConfig("/my/project");
    expect(CONFIG.claudeConfigDir).toBe("/data/claude");
  });

  it("rejects a relative claudeConfigDir", () => {
    expect(() => validateGlobalConfig({ claudeConfigDir: "claude/config" })).toThrow(
      "Invalid claudeConfigDir config"
    );
    expect(() => validateGlobalConfig({ claudeConfigDir: "" })).not.toThrow();
  });

  it("falls back to defaults when neither global nor project config exists", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    expect(CONFIG.claudeConfigDir).toBe("");
    expect(CONFIG.autoCaptureEnabled).toBe(true); // default value
    expect(CONFIG.opencodeProvider).toBeUndefined();
  });
});
