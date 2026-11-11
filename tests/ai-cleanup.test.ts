import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const aiCleanupUrl = new URL("../src/services/user-profile/ai-cleanup.js", import.meta.url).href;
const aiCleanupBatchesUrl = new URL(
  "../src/services/user-profile/ai-cleanup-batches.js",
  import.meta.url
).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const profileModelUrl = new URL("../src/adapters/opencode/profile-model.js", import.meta.url).href;
const opencodeProviderLoaderUrl = new URL(
  "../src/adapters/opencode/opencode-provider-loader.js",
  import.meta.url
).href;

function runCleanupScenario(opts: {
  generateThrows?: boolean;
  hostAvailable?: boolean;
  withExternalApi?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-ai-cleanup-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const generateThrows = opts.generateThrows ?? false;
  const hostAvailable = opts.hostAvailable ?? true;
  const withExternalApi = opts.withExternalApi ?? false;

  const script = `
import { mock } from "bun:test";

const generateCalls = [];
let externalFetchCalled = false;
let externalRequestBody = null;

const cleanupJson = JSON.stringify({
  preferences: [{ id: "pref_0", category: "style", description: "Prefer concise answers" }],
  patterns: [],
  workflows: [],
  mapping: {
    kept: ["pref_0"],
    merged: [],
    removed: ["pref_1"],
  },
});

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    opencodeProvider: "openai",
    opencodeModel: "gpt-test",
    memoryModel: ${withExternalApi ? '"gpt-ext"' : "undefined"},
    memoryApiUrl: ${withExternalApi ? '"http://example.test/v1"' : "undefined"},
    memoryApiKey: "test-key",
    memoryExtraParams: {
      enable_thinking: false,
      top_p: 0.7,
      stream: true,
      model: "must-not-override",
      messages: [{ role: "user", content: "must-not-override" }],
      temperature: 0.9,
      response_format: { type: "text" },
    },
  },
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));

mock.module(${JSON.stringify(opencodeProviderLoaderUrl)}, () => ({
  loadOpencodeProvider: async () => ({
    getOpencodeHost: () =>
      ${hostAvailable}
        ? {
            generate: {
              text: async (args) => {
                generateCalls.push(args);
                if (${generateThrows}) {
                  throw new Error("generate failed for test");
                }
                return { text: cleanupJson };
              },
            },
          }
        : undefined,
  }),
}));

if (${withExternalApi}) {
  globalThis.fetch = async (_url, init) => {
    externalFetchCalled = true;
    externalRequestBody = JSON.parse(String(init?.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: cleanupJson } }],
      }),
    };
  };
}

// The OpenCode plugin registers its profile model at start-up.
const { registerOpencodeProfileModel } = await import(${JSON.stringify(profileModelUrl)});
registerOpencodeProfileModel();
const { addIdsToProfile } = await import(${JSON.stringify(aiCleanupUrl)});
const { cleanupBatch } = await import(${JSON.stringify(aiCleanupBatchesUrl)});

const profile = {
  preferences: [
    { category: "style", description: "Prefer concise answers", confidence: 0.9, frequency: 2 },
    { category: "style", description: "likes short replies", confidence: 0.5, frequency: 1 },
  ],
  patterns: [],
  workflows: [],
};

let errorMessage = null;
let result = null;
try {
  result = await cleanupBatch(addIdsToProfile(profile));
} catch (e) {
  errorMessage = String(e?.message || e);
}

console.log(
  JSON.stringify({
    errorMessage,
    generateCalls,
    externalFetchCalled,
    externalRequestBody,
    kept: result?.diff?.kept ?? null,
    removed: result?.diff?.removed?.map((r) => r.id) ?? null,
  })
);
`;

  writeFileSync(scriptPath, script);

  const spawned = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = Buffer.from(spawned.stdout).toString("utf8").trim();
  const stderr = Buffer.from(spawned.stderr).toString("utf8").trim();

  return {
    exitCode: spawned.exitCode,
    stdout,
    stderr,
    parsed: stdout ? JSON.parse(stdout) : null,
  };
}

describe("AI cleanup opencode provider path (#177)", () => {
  it("succeeds through one sessionless host generation", () => {
    const result = runCleanupScenario({});

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.errorMessage).toBeNull();
    expect(result.parsed?.generateCalls).toHaveLength(1);
    expect(result.parsed?.generateCalls[0].model).toEqual({ providerID: "openai", id: "gpt-test" });
    expect(result.parsed?.kept).toEqual(["Prefer concise answers"]);
    expect(result.parsed?.removed).toEqual(["pref_1"]);
    expect(result.parsed?.externalFetchCalled).toBe(false);
  });

  it("surfaces opencode errors instead of masking as missing provider", () => {
    const result = runCleanupScenario({ generateThrows: true, withExternalApi: false });

    expect(result.exitCode).toBe(0);
    expect(result.parsed?.errorMessage).toContain("generate failed for test");
    expect(result.parsed?.errorMessage).not.toContain("No AI provider configured");
    expect(result.parsed?.externalFetchCalled).toBe(false);
  });

  it("does not fall back to external API when OpenCode host is available and fails", () => {
    const result = runCleanupScenario({ generateThrows: true, withExternalApi: true });

    expect(result.exitCode).toBe(0);
    expect(result.parsed?.errorMessage).toContain("generate failed for test");
    expect(result.parsed?.externalFetchCalled).toBe(false);
  });

  it("falls back to external API when OpenCode host is unavailable", () => {
    const result = runCleanupScenario({ hostAvailable: false, withExternalApi: true });

    expect(result.exitCode).toBe(0);
    expect(result.parsed?.errorMessage).toBeNull();
    expect(result.parsed?.externalFetchCalled).toBe(true);
    expect(result.parsed?.kept).toEqual(["Prefer concise answers"]);
    expect(result.parsed?.externalRequestBody).toMatchObject({
      model: "gpt-ext",
      temperature: 0.3,
      response_format: { type: "json_object" },
      enable_thinking: false,
      top_p: 0.7,
    });
    expect(result.parsed?.externalRequestBody?.stream).toBeUndefined();
    expect(result.parsed?.externalRequestBody?.messages).toHaveLength(2);
  });
});
