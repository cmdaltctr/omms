import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSpaceOperation } from "../src/services/spaces/operations.js";
import { readRegistryFile } from "../src/services/spaces/registry.js";
import { spaceFiles } from "../src/services/spaces/registry-store.js";

let root: string;
let files: ReturnType<typeof spaceFiles>;
const current = { id: "default", name: "Default", customStoragePath: false };
const run = (action: string | undefined, name?: string) =>
  executeSpaceOperation({ action, name }, { files, current });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omms-space-ops-"));
  files = spaceFiles(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("executeSpaceOperation", () => {
  it("lists Default as active when nothing was created", async () => {
    const result = await run("list");
    expect(result).toMatchObject({
      success: true,
      activeSpace: { id: "default", name: "Default" },
      spaces: [{ id: "default", name: "Default", active: true, archived: false }],
    });
  });

  it("creates a space without making it active", async () => {
    const result = await run("create", "Experiments");
    expect(result).toMatchObject({ success: true, space: { id: "experiments" } });
    expect(readRegistryFile(files.registryPath).registry.activeSpaceId).toBe("default");
    expect(existsSync(join(files.spacesRoot, "experiments"))).toBe(true);
  });

  it("switches by name and reports the new active space", async () => {
    await run("create", "Experiments");
    const result = await run("use", "experiments");
    expect(result).toMatchObject({ success: true, activeSpace: { id: "experiments" } });
    expect(readRegistryFile(files.registryPath).registry.activeSpaceId).toBe("experiments");
  });

  it("creates then archives a space while another is active, and keeps its folder", async () => {
    await run("create", "Spike");
    const result = await run("archive", "Spike");
    expect(result).toMatchObject({ success: true });
    expect(existsSync(join(files.spacesRoot, "spike"))).toBe(true);
    const listed = (await run("list")) as { spaces: { id: string; archived: boolean }[] };
    expect(listed.spaces.find((s) => s.id === "spike")?.archived).toBe(true);
    expect(await run("unarchive", "Spike")).toMatchObject({ success: true });
  });

  it("refuses to switch to an archived or unknown space and lists the valid ones", async () => {
    await run("create", "Spike");
    await run("archive", "Spike");
    const archived = (await run("use", "Spike")) as { success: boolean; error: string };
    expect(archived.success).toBe(false);
    expect(archived.error).toContain("default");
    expect(archived.error).not.toContain("spike,");
    expect(((await run("use", "nope")) as { success: boolean }).success).toBe(false);
  });

  it("refuses to archive the active space", async () => {
    await run("create", "Experiments");
    await run("use", "Experiments");
    const result = (await run("archive", "Experiments")) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain("Switch to another space first");
  });

  it.each(["delete", "rename", "backup", "restore"])(
    "refuses %s and says only the web app can do it",
    async (action) => {
      await run("create", "Experiments");
      const result = (await run(action, "Experiments")) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toBe(`Only the web app can ${action} a space.`);
      expect(existsSync(join(files.spacesRoot, "experiments"))).toBe(true);
    }
  );

  it("reports the status of the space in use, including a custom folder", async () => {
    const status = await executeSpaceOperation(
      { action: "status" },
      { files, current: { id: "default", name: "Default", customStoragePath: true } }
    );
    expect(status).toMatchObject({ success: true, activeSpace: { customStoragePath: true } });
  });

  it("asks for a name when one is needed and rejects an unknown action", async () => {
    expect(((await run("create")) as { error: string }).error).toContain("name");
    const unknown = (await run("explode")) as { success: boolean; error: string };
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain("list");
  });

  it("defaults to list when no action is given", async () => {
    expect(await run(undefined)).toMatchObject({ success: true, spaces: [{ id: "default" }] });
  });
});
