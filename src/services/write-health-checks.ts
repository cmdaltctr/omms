import { join } from "node:path";
import type { CONFIG } from "../config.js";
import { getStoragePath } from "./active-space-access.js";
import { createWriteHealth, type WriteHealthResult } from "./write-health.js";

/** The credentials of the latest check, copied on each call so a reload is seen. */
let secrets: Array<string | undefined> = [];

const writeHealth = createWriteHealth({
  openStore: async () => {
    const { tursoConnectionManager } = await import("./turso/connection-manager.js");
    const db = await tursoConnectionManager.getConnection(
      join(getStoragePath(), "user-prompts.db")
    );
    await db.all("SELECT 1");
  },
  embed: async () => {
    const { embeddingService } = await import("./embedding.js");
    const vector = await embeddingService.embedWithTimeout("OMMS health check", { task: "query" });
    return vector.length;
  },
  secrets: () => secrets,
});

/** Whether a new memory can be saved now. Reuses a result for 30 seconds unless `fresh`. */
export function checkWriteHealth(
  fresh: boolean,
  config: Pick<typeof CONFIG, "embeddingApiKey" | "memoryApiKey">
): Promise<WriteHealthResult> {
  secrets = [config.embeddingApiKey, config.memoryApiKey];
  return writeHealth.check({ fresh });
}
