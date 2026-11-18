import { tursoConnectionManager } from "../turso/connection-manager.js";

/** Opens the store file at `path` and runs one trivial query; throws when it cannot. */
export async function pingStore(path: string): Promise<void> {
  const db = await tursoConnectionManager.getConnection(path);
  await db.all("SELECT 1");
}
