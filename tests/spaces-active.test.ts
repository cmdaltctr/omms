import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveActiveSpace } from "../src/services/spaces/active-space.js";

let omms: string;
const global = () => join(omms, "data");

function writeRegistry(activeSpaceId: string, names: string[]) {
  const spaces = names.map((name) => ({
    id: name.toLowerCase(),
    name,
    createdAt: "2026-11-06T10:00:00.000Z",
    archived: false,
  }));
  writeFileSync(join(omms, "spaces.json"), JSON.stringify({ version: 1, activeSpaceId, spaces }));
}

beforeEach(() => {
  omms = mkdtempSync(join(tmpdir(), "omms-active-"));
});
afterEach(() => rmSync(omms, { recursive: true, force: true }));

describe("resolveActiveSpace", () => {
  it("uses Default and the global path when there is no registry", () => {
    const space = resolveActiveSpace(omms, global(), false);
    expect(space).toMatchObject({ id: "default", name: "Default", customStoragePath: false });
    expect(space.storagePath).toBeUndefined();
    expect(space.problem).toBeUndefined();
  });

  it("gives the space folder for a non-default active space", () => {
    writeRegistry("experiments", ["Experiments"]);
    mkdirSync(join(omms, "spaces", "experiments"), { recursive: true });
    const space = resolveActiveSpace(omms, global(), false);
    expect(space.id).toBe("experiments");
    expect(space.name).toBe("Experiments");
    expect(space.storagePath).toBe(join(omms, "spaces", "experiments"));
  });

  it("lets a project storagePath win and marks it custom", () => {
    writeRegistry("experiments", ["Experiments"]);
    mkdirSync(join(omms, "spaces", "experiments"), { recursive: true });
    const space = resolveActiveSpace(omms, global(), true);
    expect(space.storagePath).toBeUndefined();
    expect(space.customStoragePath).toBe(true);
  });

  it("falls back to Default with a problem when the space folder is missing", () => {
    writeRegistry("experiments", ["Experiments"]);
    const space = resolveActiveSpace(omms, global(), false);
    expect(space.id).toBe("default");
    expect(space.storagePath).toBeUndefined();
    expect(space.problem).toContain("Experiments");
  });

  it("falls back to Default with a problem when the registry cannot be read", () => {
    writeFileSync(join(omms, "spaces.json"), "{broken");
    const space = resolveActiveSpace(omms, global(), false);
    expect(space.id).toBe("default");
    expect(space.problem).toContain("spaces.json");
  });
});
