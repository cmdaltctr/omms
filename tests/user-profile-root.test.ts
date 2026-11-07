import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";
import { removeTestDir } from "./turso-test-utils.js";

// A manager rooted at a space folder (design D1, profile import) must read and
// write only that folder, whatever CONFIG.storagePath says.
describe("UserProfileManager root", () => {
  let root = "";
  let scratch = "";

  afterEach(async () => {
    await removeTestDir(root);
    await removeTestDir(scratch);
  });

  it("reads and writes only inside its root", async () => {
    root = mkdtempSync(join(tmpdir(), "user-profile-root-"));
    scratch = mkdtempSync(join(tmpdir(), "user-profile-scratch-"));
    const { CONFIG } = await import("../src/config.js");
    const previous = CONFIG.storagePath;
    CONFIG.storagePath = scratch;

    const { TursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const { UserProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    const connections = new TursoConnectionManager(createClient, () => [root]);
    const manager = new UserProfileManager(root, connections);
    try {
      await manager.createProfile(
        "user-rooted",
        "Rooted User",
        "Rooted Name",
        "rooted@example.com",
        { preferences: [], patterns: [], workflows: [] },
        3
      );

      expect(existsSync(join(root, "user-profiles.db"))).toBe(true);
      expect(existsSync(join(scratch, "user-profiles.db"))).toBe(false);

      const profile = await manager.getActiveProfile("user-rooted");
      expect(profile?.displayName).toBe("Rooted User");
      const changelogs = await manager.getProfileChangelogs(profile?.id ?? "");
      expect(changelogs).toHaveLength(1);

      // The rooted manager leaves the active store untouched.
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      CONFIG.storagePath = previous;
      await connections.closeAll();
    }
  });
});
