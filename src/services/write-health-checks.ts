import { join } from "node:path";
import { CONFIG } from "../config.js";
import { createWriteHealth, type WriteHealthResult } from "./write-health.js";

const writeHealth = createWriteHealth({
  openStore: async () => {
    const { tursoConnectionManager } = await import("./turso/connection-manager.js");
    const db = await tursoConnectionManager.getConnection(
      join(CONFIG.storagePath, "user-prompts.db")
    );
    await db.all("SELECT 1");
  },
  embed: async () => {
    const { embeddingService } = await import("./embedding.js");
    const vector = await embeddingService.embedWithTimeout("OMMS health check", { task: "query" });
    return vector.length;
  },
  secrets: () => [CONFIG.embeddingApiKey, CONFIG.memoryApiKey],
});

/** Whether a new memory can be saved now. Reuses a result for 30 seconds unless `fresh`. */
export function checkWriteHealth(fresh = false): Promise<WriteHealthResult> {
  return writeHealth.check({ fresh });
}
