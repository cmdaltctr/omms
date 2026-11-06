import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG, initConfig } from "../src/config.js";
import { loadLocalTransformersBackend } from "../src/services/embedding.js";

const omms = join(homedir(), ".omms");

afterAll(() => {
  rmSync(join(omms, "spaces.json"), { force: true });
  rmSync(join(omms, "spaces"), { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

describe("embedding model cache", () => {
  it("stays in the global storage path when a memory space is active", async () => {
    mkdirSync(join(omms, "spaces", "experiments"), { recursive: true });
    writeFileSync(
      join(omms, "spaces.json"),
      JSON.stringify({
        version: 1,
        activeSpaceId: "experiments",
        spaces: [
          {
            id: "experiments",
            name: "Experiments",
            createdAt: "2026-11-06T10:00:00Z",
            archived: false,
          },
        ],
      })
    );
    initConfig("/nonexistent-project");
    expect(CONFIG.storagePath).toBe(join(omms, "spaces", "experiments"));

    const transformers = await loadLocalTransformersBackend();

    expect(transformers.env.cacheDir).toBe(join(omms, "data", ".cache"));
  });
});
