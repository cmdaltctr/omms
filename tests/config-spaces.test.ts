import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, getActiveSpace, initConfig, refreshConfigIfChanged } from "../src/config.js";

// The isolated runner gives each run an empty home, so these files are private to the run.
const omms = join(homedir(), ".omms");
const registryPath = join(omms, "spaces.json");
const globalData = join(omms, "data");
let project: string;

function useSpace(id: string, name: string) {
  mkdirSync(join(omms, "spaces", id), { recursive: true });
  writeFileSync(
    registryPath,
    JSON.stringify({
      version: 1,
      activeSpaceId: id,
      spaces: [{ id, name, createdAt: "2026-11-06T10:00:00.000Z", archived: false }],
    })
  );
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "omms-config-spaces-"));
});
afterEach(() => {
  rmSync(registryPath, { force: true });
  rmSync(join(omms, "spaces"), { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

describe("storagePath from the active space", () => {
  it("uses the Default space and the global path when there is no registry", () => {
    initConfig(project);
    expect(CONFIG.storagePath).toBe(globalData);
    expect(getActiveSpace().id).toBe("default");
  });

  it("uses the space folder for a non-default active space and keeps skills.db global", () => {
    useSpace("experiments", "Experiments");
    initConfig(project);
    expect(CONFIG.storagePath).toBe(join(omms, "spaces", "experiments"));
    expect(CONFIG.skillStoragePath).toBe(globalData);
    expect(getActiveSpace()).toMatchObject({ id: "experiments", name: "Experiments" });
  });

  it("lets a project storagePath win and marks it custom", () => {
    useSpace("experiments", "Experiments");
    const custom = join(project, "own-store");
    mkdirSync(join(project, ".opencode"), { recursive: true });
    writeFileSync(
      join(project, ".opencode", "omms.jsonc"),
      JSON.stringify({ storagePath: custom })
    );
    initConfig(project);
    expect(CONFIG.storagePath).toBe(custom);
    expect(getActiveSpace().customStoragePath).toBe(true);
  });

  it("falls back to Default with a problem when the active space folder is missing", () => {
    useSpace("experiments", "Experiments");
    rmSync(join(omms, "spaces", "experiments"), { recursive: true });
    initConfig(project);
    expect(CONFIG.storagePath).toBe(globalData);
    expect(getActiveSpace().problem).toContain("Experiments");
  });

  it("reloads the storage path when spaces.json changes", () => {
    initConfig(project);
    expect(CONFIG.storagePath).toBe(globalData);
    useSpace("experiments", "Experiments");
    refreshConfigIfChanged(project);
    expect(CONFIG.storagePath).toBe(join(omms, "spaces", "experiments"));
    rmSync(registryPath);
    refreshConfigIfChanged(project);
    expect(CONFIG.storagePath).toBe(globalData);
  });
});
