import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const profileModule = pathToFileURL(join(import.meta.dir, "../src/adapters/pi/profile.js")).href;
const profileManagerModule = pathToFileURL(
  join(import.meta.dir, "../src/services/user-profile/user-profile-manager.js")
).href;
const loggerModule = pathToFileURL(join(import.meta.dir, "../src/services/logger.js")).href;

function runScenario(body: string): any {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-pi-profile-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const mergeCalls = [];

mock.module(${JSON.stringify(profileManagerModule)}, () => ({
  userProfileManager: {
    mergeProfileData: async (existing, incoming, _opts, profileId) => {
      mergeCalls.push({ existing, incoming, profileId });
      return {
        ...existing,
        preferences: [...(existing.preferences ?? []), ...(incoming.preferences ?? [])],
      };
    },
  },
}));

mock.module(${JSON.stringify(loggerModule)}, () => ({ log: () => {} }));

const { createPiProfileAnalyzer } = await import(${JSON.stringify(profileModule)});

function modelReturning(text, extra = {}) {
  return {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    complete: async () => ({
      content: [{ type: "text", text }],
      stopReason: "stop",
      ...extra,
    }),
  };
}

let scenario;

${body}

console.log("RESULT:" + JSON.stringify({ scenario, mergeCalls }));
`;

  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: dir });
  const stdout = proc.stdout.toString();
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) {
    throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
  }
  return JSON.parse(match[1]);
}

const VALID_PROFILE = JSON.stringify({
  preferences: [
    {
      category: "style",
      description: "prefers concise answers",
      confidence: 0.9,
      evidence: ["p1"],
    },
  ],
  patterns: [{ category: "workflow", description: "tests after each change" }],
  workflows: [{ description: "ship via PR", steps: ["branch", "review", "merge"] }],
});

describe("Pi profile analyzer bridge", () => {
  it("validates a plain JSON reply with the shared schema and merges into the existing profile", () => {
    const out = runScenario(`
const analyzer = createPiProfileAnalyzer(() => modelReturning(${JSON.stringify(VALID_PROFILE)}));
const result = await analyzer.analyzeProfile("prompts context", {
  id: "42",
  profileData: JSON.stringify({ preferences: [], patterns: [], workflows: [] }),
});
scenario = result;
`);

    expect(out.scenario.raw.preferences[0].description).toBe("prefers concise answers");
    expect(out.scenario.merged.preferences.length).toBe(1);
    expect(out.mergeCalls.length).toBe(1);
    expect(out.mergeCalls[0].profileId).toBe("42");
  });

  it("accepts fenced JSON with surrounding prose", () => {
    const out = runScenario(`
const analyzer = createPiProfileAnalyzer(() =>
  modelReturning("Here you go:\\n\`\`\`json\\n" + ${JSON.stringify(VALID_PROFILE)} + "\\n\`\`\\nDone.")
);
const result = await analyzer.analyzeProfile("ctx", null);
scenario = result ? { prefs: result.raw.preferences.length } : null;
`);

    expect(out.scenario.prefs).toBe(1);
  });

  it("creates without merging when no profile exists", () => {
    const out = runScenario(`
const analyzer = createPiProfileAnalyzer(() => modelReturning(${JSON.stringify(VALID_PROFILE)}));
const result = await analyzer.analyzeProfile("ctx", null);
scenario = { merged: result.merged, mergeCalls: 0 };
`);

    expect(out.scenario.merged).toBeNull();
    expect(out.mergeCalls.length).toBe(0);
  });

  it("throws when the reply fails the shared schema", () => {
    const out = runScenario(`
const analyzer = createPiProfileAnalyzer(() => modelReturning(JSON.stringify({ preferences: "nope" })));
try {
  await analyzer.analyzeProfile("ctx", null);
  scenario = "no-throw";
} catch (error) {
  scenario = String(error);
}
`);

    expect(out.scenario).toContain("invalid profile payload");
  });

  it("returns null when no model is available", () => {
    const out = runScenario(`
const analyzer = createPiProfileAnalyzer(() => null);
scenario = await analyzer.analyzeProfile("ctx", null);
`);

    expect(out.scenario).toBeNull();
  });

  it("propagates provider errors and timeouts", () => {
    const out = runScenario(`
const failing = createPiProfileAnalyzer(() =>
  modelReturning("irrelevant", { stopReason: "error", errorMessage: "rate limited" })
);
let providerError = null;
try {
  await failing.analyzeProfile("ctx", null);
} catch (error) {
  providerError = String(error);
}

const hanging = createPiProfileAnalyzer(
  () => ({
    provider: "x",
    modelId: "y",
    complete: () => new Promise(() => {}),
  }),
  50
);
let timeoutError = null;
try {
  await hanging.analyzeProfile("ctx", null);
} catch (error) {
  timeoutError = String(error);
}
scenario = { providerError, timeoutError };
`);

    expect(out.scenario.providerError).toContain("rate limited");
    expect(out.scenario.timeoutError).toContain("timeout");
  });
});
