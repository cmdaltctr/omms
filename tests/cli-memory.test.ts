import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `om-memory-system memory <mode>` runs the shared memory operations from a
 * terminal with host `claude-code`. Each scenario runs in its own process
 * with a temporary HOME, so the real config and store are never touched.
 * Only embeddings, the storage ready gate, and the logger are stubbed.
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const moduleUrl = (path: string) => pathToFileURL(join(import.meta.dir, "..", path)).href;
const commandModule = moduleUrl("src/cli/memory-command.js");
const embeddingModule = moduleUrl("src/services/embedding.js");
const readyModule = moduleUrl("src/services/turso/ready.js");
const loggerModule = moduleUrl("src/services/logger.js");
const clientModule = moduleUrl("src/services/client.js");
const tagsModule = moduleUrl("src/services/tags.js");

interface CommandRun {
  code: number;
  stdout: string[];
  stderr: string[];
}

interface Harness {
  home: string;
  projectDir: string;
  run: (code: string) => Promise<any>;
}

function createHarness(): Harness {
  const home = mkdtempSync(join(tmpdir(), "omms-cli-memory-home-"));
  const projectDir = mkdtempSync(join(tmpdir(), "omms-cli-memory-project-"));
  const workDir = mkdtempSync(join(tmpdir(), "omms-cli-memory-run-"));
  tempDirs.push(home, projectDir, workDir);

  const run = async (code: string): Promise<any> => {
    const script = `
const { mock } = await import("bun:test");

const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
class EmbeddingServiceStub {
  static getInstance() {
    return embeddingStub;
  }
}
mock.module(${JSON.stringify(embeddingModule)}, () => ({
  embeddingService: embeddingStub,
  EmbeddingService: EmbeddingServiceStub,
  applyEmbeddingTaskPrefix: (_model, text) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module(${JSON.stringify(readyModule)}, () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));
mock.module(${JSON.stringify(loggerModule)}, () => ({ log: () => {} }));

const { runMemoryCommand } = await import(${JSON.stringify(commandModule)});
const projectDir = ${JSON.stringify(projectDir)};

async function cli(argv, cwd = projectDir) {
  const stdout = [];
  const stderr = [];
  const code = await runMemoryCommand(argv, {
    cwd,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  });
  return { code, stdout, stderr };
}

let scenario;
${code}

if (globalThis.__ommsClientLoaded) {
  const { memoryClient } = await import(${JSON.stringify(clientModule)});
  await memoryClient.close();
}
console.log("RESULT:" + JSON.stringify(typeof scenario !== "undefined" ? scenario : null));
`;
    const scriptPath = join(workDir, `scenario-${Date.now()}.mjs`);
    writeFileSync(scriptPath, script);
    const proc = Bun.spawnSync(["bun", "run", scriptPath], {
      cwd: workDir,
      env: { ...process.env, HOME: home, OMMS_SKIP_LEGACY_MIGRATION: "1" },
    });
    const stdout = proc.stdout.toString();
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) {
      throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
    }
    return JSON.parse(match[1]);
  };

  return { home, projectDir, run };
}

/** Give the temporary HOME a global config that points at a temporary store. */
function writeGlobalConfig(home: string): void {
  const configDir = join(home, ".config", "omms");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "omms.jsonc"),
    JSON.stringify({ storagePath: join(home, "store"), embeddingDimensions: 4 })
  );
}

function onlyJson(run: CommandRun): any {
  expect(run.stdout).toHaveLength(1);
  return JSON.parse(run.stdout[0]!);
}

const LOAD_STORED_ROWS = `
globalThis.__ommsClientLoaded = true;
const { memoryClient } = await import(${JSON.stringify(clientModule)});
const { getTags } = await import(${JSON.stringify(tagsModule)});
const listed = await memoryClient.listMemories(getTags(projectDir).project.tag, 20);
const rows = listed.memories.map((m) => ({ id: m.id, summary: m.summary, metadata: m.metadata }));
`;

describe("om-memory-system memory", () => {
  it("prints usage with every mode for --help and no mode, without loading the engine", async () => {
    const { home, run } = createHarness();
    const scenario = await run(`
scenario = { help: await cli(["--help"]), bare: await cli([]) };
`);

    for (const result of [scenario.help, scenario.bare] as CommandRun[]) {
      expect(result.code).toBe(0);
      const usage = result.stdout.join("\n");
      expect(usage).toContain("om-memory-system memory <mode>");
      for (const mode of [
        "add",
        "search",
        "profile",
        "list",
        "forget",
        "help",
        "list-shards",
        "migrate",
        "export",
        "import",
      ]) {
        expect(usage).toMatch(new RegExp(`^\\s+${mode}\\s`, "m"));
      }
    }
    // src/config.ts creates ~/.config/omms when it loads; usage must not load it.
    expect(existsSync(join(home, ".config", "omms"))).toBe(false);
  });

  it("rejects an unknown mode on stderr with exit 1", async () => {
    const { home, run } = createHarness();
    const scenario = await run(`scenario = await cli(["remember", "--content", "x"]);`);

    expect(scenario.code).toBe(1);
    expect(scenario.stdout).toEqual([]);
    expect(scenario.stderr.join("\n")).toContain('Unknown memory mode "remember"');
    expect(existsSync(join(home, ".config", "omms"))).toBe(false);
  });

  it("rejects a bad option value on stderr with exit 1", async () => {
    const { run } = createHarness();
    const scenario = await run(`
scenario = {
  limit: await cli(["list", "--limit", "many"]),
  flag: await cli(["add", "--colour", "blue"]),
  missing: await cli(["add", "--content"]),
};
`);

    expect(scenario.limit.code).toBe(1);
    expect(scenario.limit.stderr.join("\n")).toContain("--limit");
    expect(scenario.flag.code).toBe(1);
    expect(scenario.flag.stderr.join("\n")).toContain("--colour");
    expect(scenario.missing.code).toBe(1);
    expect(scenario.missing.stderr.join("\n")).toContain("--content");
  });

  it("adds a memory with host claude-code and prints one JSON document", async () => {
    const { home, run } = createHarness();
    writeGlobalConfig(home);
    const scenario = await run(`
const add = await cli(["add", "--content", "Use libSQL for the store", "--type", "decision", "--tags", "Storage, db"]);
${LOAD_STORED_ROWS}
scenario = { add, rows };
`);

    expect(scenario.add.code).toBe(0);
    expect(scenario.add.stderr).toEqual([]);
    const result = onlyJson(scenario.add);
    expect(result).toMatchObject({
      success: true,
      message: "Memory added",
      tags: ["storage", "db"],
    });
    expect(typeof result.id).toBe("string");

    expect(scenario.rows).toHaveLength(1);
    expect(scenario.rows[0].id).toBe(result.id);
    expect(scenario.rows[0].summary).toBe("Use libSQL for the store");
    expect(scenario.rows[0].metadata.host).toBe("claude-code");
  });

  it("strips <private> text before storage and blocks fully private content", async () => {
    const { home, run } = createHarness();
    writeGlobalConfig(home);
    const scenario = await run(`
const partial = await cli(["add", "--content", "Deploy key is <private>hunter2-secret</private> in the vault"]);
const full = await cli(["add", "--content", "<private>hunter2-secret</private>"]);
${LOAD_STORED_ROWS}
scenario = { partial, full, rows };
`);

    expect(scenario.partial.code).toBe(0);
    expect(onlyJson(scenario.partial).success).toBe(true);
    expect(scenario.full.code).toBe(1);
    expect(onlyJson(scenario.full)).toEqual({ success: false, error: "Private content blocked" });

    expect(scenario.rows).toHaveLength(1);
    expect(scenario.rows[0].summary).not.toContain("hunter2-secret");
    expect(scenario.rows[0].summary).toContain("[REDACTED]");
  });

  it("searches with a positional query and prints ids and similarity", async () => {
    const { home, run } = createHarness();
    writeGlobalConfig(home);
    const scenario = await run(`
const add = await cli(["add", "--content", "Chose libSQL as the database", "--type", "decision"]);
const search = await cli(["search", "database choice"]);
const flagged = await cli(["search", "--query", "database choice", "--limit", "1"]);
scenario = { add, search, flagged };
`);

    const added = onlyJson(scenario.add);
    expect(scenario.search.code).toBe(0);
    const search = onlyJson(scenario.search);
    expect(search).toMatchObject({ success: true, query: "database choice", count: 1 });
    expect(search.results[0]).toMatchObject({
      id: added.id,
      content: "Chose libSQL as the database",
    });
    expect(typeof search.results[0].similarity).toBe("number");
    expect(onlyJson(scenario.flagged).results).toHaveLength(1);
  });

  it("lists with --limit, forgets by --id, and honours --directory", async () => {
    const { home, run } = createHarness();
    writeGlobalConfig(home);
    const otherDir = mkdtempSync(join(tmpdir(), "omms-cli-memory-other-"));
    tempDirs.push(otherDir);
    const scenario = await run(`
const first = await cli(["add", "--content", "First note about caching"]);
const second = await cli(["add", "--content", "Second note about retries"]);
const listAll = await cli(["list"]);
const listOne = await cli(["list", "--limit", "1"]);
const elsewhere = await cli(["list"], ${JSON.stringify(otherDir)});
const viaDirectory = await cli(["list", "--directory", projectDir], ${JSON.stringify(otherDir)});
const forget = await cli(["forget", "--id", JSON.parse(first.stdout[0]).id]);
const afterForget = await cli(["list"]);
const missingId = await cli(["forget"]);
scenario = { first, second, listAll, listOne, elsewhere, viaDirectory, forget, afterForget, missingId };
`);

    const firstId = onlyJson(scenario.first).id;
    const secondId = onlyJson(scenario.second).id;
    const listAll = onlyJson(scenario.listAll);
    expect(listAll.success).toBe(true);
    expect(listAll.count).toBe(2);
    expect(listAll.memories.map((m: any) => m.id).sort()).toEqual([firstId, secondId].sort());
    expect(onlyJson(scenario.listOne).count).toBe(1);
    expect(onlyJson(scenario.elsewhere).count).toBe(0);
    expect(onlyJson(scenario.viaDirectory).count).toBe(2);

    expect(scenario.forget.code).toBe(0);
    expect(onlyJson(scenario.forget)).toEqual({ success: true, message: "Memory removed" });
    const afterForget = onlyJson(scenario.afterForget);
    expect(afterForget.memories.map((m: any) => m.id)).toEqual([secondId]);

    expect(scenario.missingId.code).toBe(1);
    expect(onlyJson(scenario.missingId)).toEqual({ success: false, error: "memoryId required" });
  });
});
