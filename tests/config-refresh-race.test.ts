import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A config refresh must notice every change to `spaces.json`, or the process keeps writing to
 * the old memory space with no warning. The ids are unique to this file: the runner shares one
 * home folder across test files.
 */

const realResolve = (await import("../src/services/spaces/active-space.js")).resolveActiveSpace;
/** Runs once, right after the next registry read, to stand in for a switch by another process. */
let afterNextRead: (() => void) | undefined;
mock.module("../src/services/spaces/active-space.js", () => ({
  resolveActiveSpace: (...args: Parameters<typeof realResolve>) => {
    const space = realResolve(...args);
    const hook = afterNextRead;
    afterNextRead = undefined;
    hook?.();
    return space;
  },
}));

const config = await import("../src/config.js");

const omms = join(homedir(), ".omms");
const registryPath = join(omms, "spaces.json");
const folder = (id: string) => join(omms, "spaces", id);
let project: string;

/** Writes the registry the way the registry store does: a temporary file, then a rename. */
function writeRegistry(activeSpaceId: string, mtimeSeconds?: number) {
  const spaces = ["racex", "racey"].map((id) => ({
    id,
    name: id,
    createdAt: "2026-11-18T10:00:00.000Z",
    archived: false,
  }));
  const temporary = `${registryPath}.race.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, activeSpaceId, spaces }));
  renameSync(temporary, registryPath);
  if (mtimeSeconds !== undefined) utimesSync(registryPath, mtimeSeconds, mtimeSeconds);
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-refresh-race-"));
  mkdirSync(folder("racex"), { recursive: true });
  mkdirSync(folder("racey"), { recursive: true });
  writeRegistry("default");
  config.initConfig(project);
});
afterAll(() => {
  rmSync(folder("racex"), { recursive: true, force: true });
  rmSync(folder("racey"), { recursive: true, force: true });
  rmSync(registryPath, { force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("config refresh and a space switch", () => {
  it("reloads on the next refresh when a switch lands while the config loads", () => {
    writeRegistry("racex");
    afterNextRead = () => writeRegistry("racey");
    config.refreshConfigIfChanged(project);
    // This load read the registry before the switch, so it still uses the first space.
    expect(config.CONFIG.storagePath).toBe(folder("racex"));

    config.refreshConfigIfChanged(project);
    expect(config.CONFIG.storagePath).toBe(folder("racey"));
  });

  it("reloads when the registry is replaced with a file of the same size and time", () => {
    writeRegistry("racex", 1_800_000_000);
    config.refreshConfigIfChanged(project);
    expect(config.CONFIG.storagePath).toBe(folder("racex"));

    // Both ids have the same length, and a coarse file clock can give both writes one time.
    writeRegistry("racey", 1_800_000_000);
    config.refreshConfigIfChanged(project);
    expect(config.CONFIG.storagePath).toBe(folder("racey"));
  });
});
