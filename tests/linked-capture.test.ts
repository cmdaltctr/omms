import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Capture and profile steps stay in the own space while links exist (task 5.2).
 * A child process runs the real capture pipeline against a real registry whose
 * active space links another space; the read-store module is mocked so any
 * attempt to open a linked space is recorded. A second scenario proves the
 * recording works by reading a linked space on purpose.
 */

const tempDirs: string[] = [];

const captureUrl = new URL("../src/core/capture.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const embeddingUrl = new URL("../src/services/embedding.js", import.meta.url).href;
const readStoreCacheUrl = new URL("../src/services/spaces/read-store-cache.js", import.meta.url)
  .href;
const configUrl = new URL("../src/config.js", import.meta.url).href;

const TAG_HASH = "0123456789abcdef";
const TAG = `omms_project_${TAG_HASH}`;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;

function runScenario(scriptBody: string) {
  const dir = mkdtempSync(join(tmpdir(), "omms-linked-capture-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const readStoreCalls = [];

mock.module(${JSON.stringify(embeddingUrl)}, () => ({
  embeddingService: {
    isWarmedUp: true,
    initError: null,
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array(768).fill(0.25),
  },
}));

mock.module(${JSON.stringify(readStoreCacheUrl)}, () => ({
  getCachedSpaceReadStore: (folder) => {
    readStoreCalls.push(folder);
    throw new Error("linked read store must not be opened in this scenario");
  },
  closeCachedSpaceReadStore: async () => {},
  closeAllCachedSpaceReadStores: async () => {},
}));

// The registry exists before config.js loads, so the active space is alpha.
// The ids are unique to this file: the runner shares one home folder across
// test files, and another file's left-over spaces must not break the check
// that the linked folder stays empty.
const omms = join(homedir(), ".omms");
mkdirSync(join(omms, "spaces", "capalpha"), { recursive: true });
mkdirSync(join(omms, "spaces", "capbeta"), { recursive: true });
writeFileSync(
  join(omms, "spaces.json"),
  JSON.stringify({
    version: 1,
    activeSpaceId: "capalpha",
    spaces: [
      { id: "capalpha", name: "Alpha", createdAt: "2026-11-06T09:00:00.000Z", archived: false, links: ["capbeta"] },
      { id: "capbeta", name: "Beta", createdAt: "2026-11-06T09:00:00.000Z", archived: false },
    ],
  })
);

const { initConfig } = await import(${JSON.stringify(configUrl)});
initConfig(${JSON.stringify(dir)});

// The capture pipeline derives the project tag from the project directory.
const { getTags } = await import(${JSON.stringify(tagsUrl)});
const projectTag = getTags(${JSON.stringify(dir)}).project.tag;

${scriptBody}
`;
  const scriptWithDir = script.replaceAll("__SCENARIO_DIR__", JSON.stringify(dir));
  writeFileSync(scriptPath, scriptWithDir, "utf-8");
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  const jsonLine = stdout
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"));

  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
    parsed: jsonLine ? JSON.parse(jsonLine) : null,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("capture stays in the own space while links exist", () => {
  it("a capture and a profile read open no linked store and write nothing to the linked folder", () => {
    const result = runScenario(`
const { captureConversation } = await import(${JSON.stringify(captureUrl)});
const { memoryClient } = await import(${JSON.stringify(clientUrl)});

const captured = await captureConversation(
  {
    host: "opencode",
    sourceType: "agent-turn",
    hostSessionId: "sess-linked-capture",
    projectDirectory: __SCENARIO_DIR__,
    userPrompt: "Which port should the web server use?",
    textResponses: ["Use 4748 for the dev server."],
    toolCalls: [],
  },
  { summarize: async () => ({ summary: "Use port 4748 for the dev server.", type: "decision", tags: ["ports"] }) }
);

const profileReads = await memoryClient.searchMemoriesBySessionID("sess-linked-capture", projectTag);

const home = join(homedir(), ".omms");
console.log(JSON.stringify({
  status: captured.status,
  linkedReads: readStoreCalls.length,
  betaFiles: readdirSync(join(home, "spaces", "capbeta")),
  alphaHasFiles: readdirSync(join(home, "spaces", "capalpha")).length > 0,
  profileResults: profileReads.results.length,
}));
`);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.status).toBe("captured");
    expect(result.parsed?.linkedReads).toBe(0);
    // The start-up pass writes the space.json label into every space folder,
    // so the linked folder holds exactly that label and no store file.
    expect(result.parsed?.betaFiles).toEqual(["space.json"]);
    expect(result.parsed?.alphaHasFiles).toBe(true);
    // The profile step found the turn the capture wrote, in the own space.
    expect(result.parsed?.profileResults).toBe(1);
  });

  it("records a linked read when one is asked for, so a zero above is meaningful", () => {
    const result = runScenario(`
const { memoryClient } = await import(${JSON.stringify(clientUrl)});
await memoryClient.searchMemories("dev server port", ${JSON.stringify(TAG)}, "project", { includeLinked: true });
console.log(JSON.stringify({ linkedReads: readStoreCalls.length }));
`);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.linkedReads).toBeGreaterThanOrEqual(1);
  });
});
