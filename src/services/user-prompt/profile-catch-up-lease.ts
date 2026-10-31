import { join } from "node:path";
import { CONFIG } from "../../config.js";
import { tursoConnectionManager } from "../turso/connection-manager.js";
import { TableLease } from "../turso/table-lease.js";

export { LEASE_EXPIRY_MS, type BatchStart } from "../turso/table-lease.js";

/**
 * The catch-up run record, shared by the web app and the terminal command
 * through `user-prompts.db`. The newest run owns the record. A run sends a
 * batch only while it owns the record and no other run is mid-batch, so no
 * batch is sent twice. A record not refreshed for 10 minutes has expired.
 */
export class CatchUpLease extends TableLease {
  constructor(
    options: {
      path?: string;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ) {
    super({
      table: "profile_catch_up_lease",
      connection: () =>
        tursoConnectionManager.getConnection(
          options.path ?? join(CONFIG.storagePath, "user-prompts.db")
        ),
      now: options.now,
      sleep: options.sleep,
    });
  }
}
