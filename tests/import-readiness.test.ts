import { afterEach, expect, it, mock } from "bun:test";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { importBlockedReason, importReadiness } from "../src/importer/import-readiness.js";

const saved = {
  memoryProvider: CONFIG.memoryProvider,
  memoryModel: CONFIG.memoryModel,
  memoryApiUrl: CONFIG.memoryApiUrl,
  memoryApiKey: CONFIG.memoryApiKey,
};
afterEach(() => Object.assign(CONFIG, saved));

const deps = {
  supportedProviders: async () => ["openai-chat", "orcarouter"],
  listOpencodeModels: async () => ({
    available: true,
    models: [{ provider: "zai", model: "glm", name: "GLM" }],
  }),
  loadPiSdk: async () => ({}),
};

function configure(values: Partial<typeof saved>) {
  Object.assign(CONFIG, {
    memoryProvider: "openai-chat",
    memoryModel: "m",
    memoryApiUrl: "https://api.example.invalid",
    memoryApiKey: "sk-secret-value",
    ...values,
  });
}

it("reports the external API as ready without returning the key", async () => {
  configure({});
  const readiness = await importReadiness(deps);
  expect(readiness.external.state).toBe("ready");
  expect(JSON.stringify(readiness)).not.toContain("sk-secret-value");
  expect(readiness.opencode.models).toHaveLength(1);
  expect(readiness.piReader.available).toBe(true);
});

it("reports an env:// key that is unset in this process as a missing key", async () => {
  // Config resolution turns an unset env:// reference into an empty key.
  configure({ memoryApiKey: undefined });
  const readiness = await importReadiness(deps);
  expect(readiness.external.state).toBe("missing-key");
  expect(
    importBlockedReason(readiness, { host: "opencode", needsModel: true, modelChoice: "external" })
  ).toContain("missing in the OpenCode process");
});

it("reports a missing URL, a missing model, and an unsupported provider", async () => {
  configure({ memoryApiUrl: undefined });
  expect((await importReadiness(deps)).external.state).toBe("missing-url");
  configure({ memoryModel: undefined });
  expect((await importReadiness(deps)).external.state).toBe("missing-model");
  configure({ memoryProvider: "nope" as never });
  expect((await importReadiness(deps)).external.state).toBe("unsupported-provider");
});

it("allows a dry run with no ready model but blocks a real import", async () => {
  configure({ memoryApiKey: undefined });
  const readiness = await importReadiness({
    ...deps,
    listOpencodeModels: async () => ({ available: false }),
  });
  expect(importBlockedReason(readiness, { host: "opencode", needsModel: false })).toBeNull();
  expect(importBlockedReason(readiness, { host: "opencode", needsModel: true })).toBe(
    "Choose an import model"
  );
  expect(
    importBlockedReason(readiness, { host: "opencode", needsModel: true, modelChoice: "zai/glm" })
  ).toContain("not connected");
});

it("names the terminal and /import when an OpenCode model is chosen without host models", async () => {
  configure({});
  const readiness = await importReadiness({
    ...deps,
    listOpencodeModels: async () => ({ available: false }),
  });
  expect(readiness.opencode).toEqual({ available: false, models: [] });
  const reason = importBlockedReason(readiness, {
    host: "opencode",
    needsModel: true,
    modelChoice: "zai/glm",
  });
  expect(reason).toContain("terminal");
  expect(reason).toContain("/import");
  expect(reason).toContain("external API");
  // The external API still works, so it is the one model offered.
  expect(
    importBlockedReason(readiness, {
      host: "opencode",
      needsModel: true,
      modelChoice: "external",
    })
  ).toBeNull();
});

it("keeps the plain reason when host models exist but the chosen one is missing", async () => {
  configure({});
  const readiness = await importReadiness({
    ...deps,
    listOpencodeModels: async () => ({
      available: true,
      models: [{ provider: "zai", model: "glm", name: "GLM" }],
    }),
  });
  expect(
    importBlockedReason(readiness, {
      host: "opencode",
      needsModel: true,
      modelChoice: "zai/other",
    })
  ).toBe("The chosen OpenCode model is not connected");
});

it("blocks Pi previews and imports when the Pi SDK cannot load", async () => {
  configure({});
  const readiness = await importReadiness({
    ...deps,
    loadPiSdk: async () => {
      throw new Error("Cannot find module");
    },
  });
  expect(readiness.piReader.available).toBe(false);
  expect(importBlockedReason(readiness, { host: "pi", needsModel: false })).toContain("Pi SDK");
  expect(importBlockedReason(readiness, { host: "opencode", needsModel: false })).toBeNull();
});

it("keeps the OpenCode import models to a live session", async () => {
  let standaloneReads = 0;
  mock.module("../src/importer/opencode-standalone-models.js", () => ({
    readStandaloneOpencodeModels: async () => {
      standaloneReads += 1;
      return { outcome: "listed", models: [{ provider: "zai", model: "glm", name: "GLM" }] };
    },
  }));
  configure({});
  const readiness = await importReadiness({ ...deps, listOpencodeModels: undefined });
  expect(standaloneReads).toBe(0);
  expect(readiness.opencode).toEqual({ available: false, models: [] });
});

it("lists Claude Code with its default folder and the external API as its only model", async () => {
  configure({});
  const readiness = await importReadiness({ ...deps, claudeRoot: () => "/nonexistent/projects" });
  expect(readiness.claudeCode).toEqual({
    available: true,
    defaultRoot: "/nonexistent/projects",
    defaultRootFound: false,
    modelChoices: ["external"],
  });
  expect(importBlockedReason(readiness, { host: "claude-code", needsModel: false })).toBeNull();
  // With no choice, a Claude Code import uses the external API.
  expect(importBlockedReason(readiness, { host: "claude-code", needsModel: true })).toBeNull();
  expect(
    importBlockedReason(readiness, {
      host: "claude-code",
      needsModel: true,
      modelChoice: "external",
    })
  ).toBeNull();
  // A connected OpenCode model is still refused: Claude Code has no host models.
  expect(
    importBlockedReason(readiness, {
      host: "claude-code",
      needsModel: true,
      modelChoice: "zai/glm",
    })
  ).toBe("Claude Code imports use the external API");
});

it("reads the Claude Code folder from the claudeConfigDir setting", async () => {
  configure({});
  const before = CONFIG.claudeConfigDir;
  try {
    CONFIG.claudeConfigDir = "/nonexistent/claude-setting";
    const readiness = await importReadiness(deps);
    expect(readiness.claudeCode.defaultRoot).toBe(join("/nonexistent/claude-setting", "projects"));
    expect(readiness.claudeCode.defaultRootFound).toBe(false);
  } finally {
    CONFIG.claudeConfigDir = before;
  }
});

it("reports the missing external API setting for a Claude Code import", async () => {
  configure({ memoryApiUrl: undefined });
  const readiness = await importReadiness(deps);
  expect(importBlockedReason(readiness, { host: "claude-code", needsModel: true })).toBe(
    "The external API has no memoryApiUrl in the global config"
  );
  expect(importBlockedReason(readiness, { host: "claude-code", needsModel: false })).toBeNull();
});

it("reports whether each host's default history source exists on this machine", async () => {
  configure({});
  const present = new Set<string>();
  const readiness = await importReadiness({
    ...deps,
    claudeRoot: () => "/claude/projects",
    sourceExists: (path) => present.has(path),
  });
  expect(readiness.defaultSourceFound).toEqual({
    pi: false,
    opencode: false,
    "claude-code": false,
  });
  const { defaultImportSourcePath } = await import("../src/importer/import-sources.js");
  present.add(defaultImportSourcePath("opencode"));
  present.add("/claude/projects");
  const second = await importReadiness({
    ...deps,
    claudeRoot: () => "/claude/projects",
    sourceExists: (path) => present.has(path),
  });
  expect(second.defaultSourceFound).toEqual({ pi: false, opencode: true, "claude-code": true });
});

it("gives each host's blocked reason with and without a model (characterisation)", async () => {
  configure({});
  const ready = await importReadiness(deps);
  const noPi = await importReadiness({
    ...deps,
    loadPiSdk: async () => {
      throw new Error("Cannot find module");
    },
  });
  configure({ memoryApiUrl: undefined });
  const noUrl = await importReadiness(deps);
  const piSdk =
    "The Pi SDK (@earendil-works/pi-coding-agent) was not found. Install Pi on this computer.";
  const noUrlReason = "The external API has no memoryApiUrl in the global config";
  const cases: Array<
    [typeof ready, "pi" | "opencode" | "claude-code", boolean, string | undefined, string | null]
  > = [];
  for (const host of ["pi", "opencode"] as const) {
    cases.push(
      [ready, host, false, undefined, null],
      [ready, host, true, undefined, "Choose an import model"],
      [ready, host, true, "external", null],
      [ready, host, true, "zai/glm", null],
      [noUrl, host, true, "external", noUrlReason],
      [ready, host, true, "zai/other", "The chosen OpenCode model is not connected"]
    );
  }
  cases.push(
    [ready, "claude-code", false, undefined, null],
    [ready, "claude-code", true, undefined, null],
    [ready, "claude-code", true, "external", null],
    [ready, "claude-code", true, "zai/glm", "Claude Code imports use the external API"],
    [noUrl, "claude-code", true, undefined, noUrlReason],
    [noPi, "pi", false, undefined, piSdk],
    [noPi, "pi", true, "external", piSdk],
    [noPi, "opencode", true, "external", null],
    [noPi, "claude-code", true, undefined, null]
  );
  for (const [readiness, host, needsModel, modelChoice, reason] of cases) {
    const request = { host, needsModel, ...(modelChoice ? { modelChoice } : {}) };
    expect([host, needsModel, modelChoice, importBlockedReason(readiness, request)]).toEqual([
      host,
      needsModel,
      modelChoice,
      reason,
    ]);
  }
});

// Characterisation (modular-boundaries): the object is now built from the host registry.
it("lists each host's default source check in host order", async () => {
  configure({});
  const readiness = await importReadiness({
    ...deps,
    claudeRoot: () => "/claude/projects",
    sourceExists: () => false,
  });
  expect(Object.keys(readiness.defaultSourceFound)).toEqual(["pi", "opencode", "claude-code"]);
});
