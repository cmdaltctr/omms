import { afterEach, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { tursoShardManager } from "../src/services/turso/shard-manager.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";
import { findLiveCapturedEntryIds } from "../src/services/live-captured-entries.js";

const previousStorage = CONFIG.storagePath;
let directory: string;
afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
  CONFIG.storagePath = previousStorage;
});

it("reads live entries only from the matching host, session, and project", async () => {
  directory = mkdtempSync(join(tmpdir(), "omms-live-entries-"));
  CONFIG.storagePath = directory;
  for (const hash of ["a1b2c3d4e5f67890", "b1b2c3d4e5f67890"]) {
    const shard = await tursoShardManager.createShard("project", hash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    for (const [id, host, session, sourceType, entries] of [
      [
        `${hash}-live`,
        "pi",
        "same",
        "live-capture",
        hash.startsWith("a") ? ["user", "assistant"] : ["different"],
      ],
      [`${hash}-import`, "pi", "same", "history-import", ["imported"]],
      [`${hash}-other-session`, "pi", "other", "live-capture", ["other"]],
      [`${hash}-other-host`, "opencode", "same", "live-capture", ["host"]],
    ] as const) {
      await db.run(
        "INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at, metadata) VALUES (?, ?, vector32(?), ?, ?, ?, ?)",
        [
          id,
          "summary",
          JSON.stringify(Array(CONFIG.embeddingDimensions).fill(0)),
          hash,
          1,
          1,
          JSON.stringify({
            host,
            hostSessionId: session,
            sourceType,
            promptId: `${id}-prompt`,
            sourceEntryIds: entries,
          }),
        ]
      );
    }
  }
  expect(await findLiveCapturedEntryIds("a1b2c3d4e5f67890", "pi", "same")).toEqual(
    new Set(["user", "assistant", "a1b2c3d4e5f67890-live-prompt"])
  );
  expect(await findLiveCapturedEntryIds("b1b2c3d4e5f67890", "pi", "same")).toEqual(
    new Set(["different", "b1b2c3d4e5f67890-live-prompt"])
  );
  expect(await findLiveCapturedEntryIds("a1b2c3d4e5f67890", "pi", "missing")).toEqual(new Set());
});
