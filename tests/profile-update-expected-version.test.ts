import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

let directory: string;

async function makeManager() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  return new UserProfileManager();
}

const empty = () => ({ preferences: [], patterns: [], workflows: [] });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-expected-version-"));
});

afterEach(async () => {
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

describe("updateProfile expected version", () => {
  it("saves when the expected version matches", async () => {
    const manager = await makeManager();
    const id = await manager.createProfile(
      "u@example.invalid",
      "U",
      "u",
      "u@example.invalid",
      empty(),
      0
    );
    const version = (await manager.getProfileById(id))!.version;
    expect(await manager.updateProfile(id, empty(), 0, "Edit", version)).toBe(true);
    expect((await manager.getProfileById(id))!.version).toBe(version + 1);
  });

  it("refuses the save and changes nothing when the stored version moved on", async () => {
    const manager = await makeManager();
    const id = await manager.createProfile(
      "u@example.invalid",
      "U",
      "u",
      "u@example.invalid",
      empty(),
      0
    );
    const version = (await manager.getProfileById(id))!.version;
    expect(await manager.updateProfile(id, empty(), 0, "Learning")).toBe(true);
    const changed = { ...empty(), preferences: [] };
    expect(await manager.updateProfile(id, changed, 0, "Stale edit", version)).toBe(false);
    expect((await manager.getProfileById(id))!.version).toBe(version + 1);
    const changes = await manager.getProfileChangelogs(id);
    expect(changes.map((entry) => entry.changeSummary)).not.toContain("Stale edit");
  });

  it("keeps the old behaviour when no expected version is given", async () => {
    const manager = await makeManager();
    const id = await manager.createProfile(
      "u@example.invalid",
      "U",
      "u",
      "u@example.invalid",
      empty(),
      0
    );
    expect(await manager.updateProfile(id, empty(), 0, "One")).toBe(true);
    expect(await manager.updateProfile(id, empty(), 0, "Two")).toBe(true);
  });
});
