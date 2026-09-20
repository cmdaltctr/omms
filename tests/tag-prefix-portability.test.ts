import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const tagPrefixMigrationUrl = new URL("../src/services/tag-prefix-migration.js", import.meta.url)
  .href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const embeddingUrl = new URL("../src/services/embedding.js", import.meta.url).href;
const readyUrl = new URL("../src/services/turso/ready.js", import.meta.url).href;
const portabilityUrl = new URL("../src/services/memory-portability-service.js", import.meta.url)
  .href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const shardManagerUrl = new URL("../src/services/turso/shard-manager.js", import.meta.url).href;
const connectionManagerUrl = new URL("../src/services/turso/connection-manager.js", import.meta.url)
  .href;
const portabilitySchemaUrl = new URL("../src/shared/api/portability-schemas.js", import.meta.url)
  .href;

const WORKER_SOURCE = `
import { mock } from "bun:test";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));

mock.module(${JSON.stringify(embeddingUrl)}, () => ({
  embeddingService: {
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([1, 0]),
  },
}));
mock.module(${JSON.stringify(readyUrl)}, () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));

const { CONFIG } = await import(${JSON.stringify(configUrl)});
CONFIG.storagePath = args.storage;
CONFIG.embeddingDimensions = 2;
CONFIG.containerTagPrefix = "omms";

const { memoryPortabilityService } = await import(${JSON.stringify(portabilityUrl)});
const result = await memoryPortabilityService.importMemories({
  inputPath: args.input,
  currentDirectory: args.project,
});
const { getProjectTagInfo } = await import(${JSON.stringify(tagsUrl)});
const { tursoShardManager } = await import(${JSON.stringify(shardManagerUrl)});
const { tursoConnectionManager } = await import(${JSON.stringify(connectionManagerUrl)});
const target = getProjectTagInfo(args.project);
const hash = target.tag.split("_").at(-1);
const shards = await tursoShardManager.getAllShards("project", hash);
const row = shards[0]
  ? await (await tursoConnectionManager.getConnection(shards[0].dbPath)).get(
      "SELECT container_tag FROM memories WHERE id = 'legacy-export-memory'"
    )
  : null;
console.log("RESULT:" + JSON.stringify({ result, containerTag: row?.container_tag }));
`;

describe("tag prefix portability", () => {
  it("imports a pre-migration archive under the current omms_ tag", async () => {
    // The contract module is deliberately loaded first: until it exists, this
    // migration change remains red even though portability already re-derives tags.
    await import(tagPrefixMigrationUrl);

    const base = mkdtempSync(join(tmpdir(), "tag-prefix-portability-"));
    const home = join(base, "home");
    const storage = join(base, "store");
    const project = join(base, "project");
    const inputPath = join(base, "pre-migration-export.json");
    const workerPath = join(base, "portability-worker.mjs");
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, ".opencode-mem-project"), "\n");

    const { PORTABILITY_SCHEMA_VERSION } = await import(portabilitySchemaUrl);
    writeFileSync(
      inputPath,
      JSON.stringify({
        schemaVersion: PORTABILITY_SCHEMA_VERSION,
        exportedAt: "2026-08-04T00:00:00.000Z",
        plugin: { package: "opencode-mem", version: "2.23.0" },
        source: {
          containerTag: "opencode_project_0123456789abcdef",
          scope: "project",
          scopeHash: "0123456789abcdef",
        },
        embedding: { model: "test", dimensions: 2 },
        memories: [
          {
            id: "legacy-export-memory",
            content: "a memory exported before the tag migration",
            createdAt: 123,
          },
        ],
      }),
      null,
      2
    );
    writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

    const env = { ...process.env, HOME: home, OMMS_SKIP_TAG_PREFIX_MIGRATION: "1" };
    delete env.XDG_CONFIG_HOME;
    const childProcess = Bun.spawnSync(
      [
        "bun",
        "run",
        workerPath,
        `--storage=${storage}`,
        `--input=${inputPath}`,
        `--project=${project}`,
      ],
      { env, cwd: base }
    );

    try {
      const output = childProcess.stdout.toString();
      const match = output.match(/RESULT:(.*)$/m);
      expect(childProcess.exitCode).toBe(0);
      expect(match).not.toBeNull();
      const result = JSON.parse(match![1]) as {
        result: { success: boolean; imported?: number };
        containerTag: string | null;
      };
      expect(result.result.success).toBe(true);
      expect(result.result.imported).toBe(1);
      expect(result.containerTag).toMatch(/^omms_project_[a-f0-9]{16}$/);
    } finally {
      // The child has exited, but the shared helper also clears any parent pool
      // before deleting the temporary directory on Windows.
      await cleanupTursoTestDirectory(base);
    }
  });
});
