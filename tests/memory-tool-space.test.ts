import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, getActiveSpace, initConfig } from "../src/config.js";
import { executeMemoryOperation } from "../src/core/memory-operations.js";
import type { MemoryOperationArgs } from "../src/core/memory-operations.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const omms = join(homedir(), ".omms");
let project: string;
/** Random ids of the spaces the earlier tests create; the file shares one registry. */
let sourceId: string;
let targetId: string;
const space = (spaceAction?: string, spaceName?: string) =>
  executeMemoryOperation({ mode: "space", spaceAction, spaceName }, { directory: project });
/** A `space` mode call with the transfer arguments of design D8. */
const spaceCall = (args: Partial<MemoryOperationArgs>) =>
  executeMemoryOperation({ mode: "space", ...args }, { directory: project });

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-tool-space-"));
  // Four embedding dimensions, so a seeded shard never needs the real embedder.
  mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
  writeFileSync(
    join(homedir(), ".config", "omms", "omms.jsonc"),
    JSON.stringify({ embeddingDimensions: 4 })
  );
  initConfig(project);
});
afterAll(async () => {
  await cleanupTursoTestDirectory();
  rmSync(join(omms, "spaces.json"), { force: true });
  rmSync(join(omms, "spaces"), { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

describe("memory tool space mode", () => {
  it("lists spaces without opening the memory store", async () => {
    expect(await space("list")).toMatchObject({ success: true, activeSpace: { id: "default" } });
  });

  it("creates a space, switches to it, and the process follows at once", async () => {
    const created = (await space("create", "Aizat")) as { space: { id: string } };
    expect(created).toMatchObject({ success: true });
    expect(await space("use", "Aizat")).toMatchObject({
      success: true,
      activeSpace: { name: "Aizat" },
    });
    expect(CONFIG.storagePath).toBe(join(omms, "spaces", created.space.id));
    expect(getActiveSpace().name).toBe("Aizat");
    expect(await space("status")).toMatchObject({ activeSpace: { id: created.space.id } });
  });

  it("refuses delete and says only the web app can delete a space", async () => {
    const result = (await space("delete", "Aizat")) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("Only the web app can delete a space.");
  });

  it("creates then archives a space while another is active", async () => {
    await space("create", "Spike");
    expect(await space("archive", "Spike")).toMatchObject({ success: true });
  });

  it("refuses rename, backup and restore like delete", async () => {
    for (const action of ["rename", "backup", "restore"]) {
      const result = (await space(action, "Aizat")) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toBe(`Only the web app can ${action} a space.`);
    }
  });

  it("lists the space mode in the help guide", async () => {
    const help = (await executeMemoryOperation({ mode: "help" }, { directory: project })) as {
      commands: { command: string }[];
    };
    expect(help.commands.map((c) => c.command)).toContain("space");
  });
});

/** Writes one project memory straight into a space folder, so no embedder runs. */
async function seedMemory(folder: string, id: string, text: string, createdAt: number) {
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const store = openSpaceStore(folder, "write");
  try {
    const shard = await store.shards.getWriteShard("project", "dddddddddddddddd");
    const db = await store.connections.getConnection(shard.dbPath);
    await tursoVectorSearch.insertVector(db, {
      id,
      content: text,
      vector: new Float32Array([1, 0, 0, 0]),
      containerTag: "omms_project_dddddddddddddddd",
      createdAt,
      updatedAt: createdAt,
      projectName: "Probe",
    });
  } finally {
    await store.close();
  }
}

describe("memory tool space transfer actions", () => {
  const OCTOBER = { spaceSince: "2026-10-01", spaceUntil: "2026-11-01" };
  const CREATED_AT = Date.UTC(2026, 9, 15);

  it("previews a transfer by date range without changing either space", async () => {
    sourceId = ((await space("create", "Source")) as { space: { id: string } }).space.id;
    targetId = ((await space("create", "Target")) as { space: { id: string } }).space.id;
    await seedMemory(join(omms, "spaces", sourceId), "mem-tool-1", "tool probe memory", CREATED_AT);
    const result = (await spaceCall({
      spaceAction: "preview",
      spaceName: "Source",
      spaceTo: "Target",
      ...OCTOBER,
    })) as {
      success: boolean;
      preview?: { matched: number; toCopy: number; groups: { name: string }[] };
    };
    expect(result.success).toBe(true);
    expect(result.preview).toMatchObject({ matched: 1, toCopy: 1, duplicates: 0 });
    expect(result.preview?.groups).toEqual([
      { name: "Probe", tag: "omms_project_dddddddddddddddd", count: 1 },
    ]);
  });

  it("copies, then skips the same memories as duplicates on a re-run", async () => {
    const first = (await spaceCall({
      spaceAction: "copy",
      spaceName: "Source",
      spaceTo: "Target",
      ...OCTOBER,
    })) as { success: boolean; copied?: number; skipped?: number };
    expect(first.success).toBe(true);
    expect(first).toMatchObject({ copied: 1, skipped: 0 });
    const again = (await spaceCall({
      spaceAction: "copy",
      spaceName: "Source",
      spaceTo: "Target",
      ...OCTOBER,
    })) as { success: boolean };
    expect(again).toMatchObject({ success: true, copied: 0, skipped: 1 });
  });

  it("refuses a transfer whose dates are not ISO 8601", async () => {
    const bad = (await spaceCall({
      spaceAction: "preview",
      spaceName: "Source",
      spaceTo: "Target",
      spaceSince: "not-a-date",
    })) as { success: boolean; error: string };
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("not a valid ISO 8601 date");
  });

  it("links and unlinks a space by name, with the owner from spaceIn", async () => {
    const linked = (await spaceCall({
      spaceAction: "link",
      spaceName: "Target",
      spaceIn: "Source",
    })) as {
      success: boolean;
      message?: string;
      links?: { name: string }[];
    };
    expect(linked.success).toBe(true);
    expect(linked.message).toBe('Space "Source" now links "Target".');
    expect(linked.links).toEqual([{ id: targetId, name: "Target", available: true }]);
    const unlinked = (await spaceCall({
      spaceAction: "unlink",
      spaceName: "Target",
      spaceIn: "Source",
    })) as { success: boolean; message?: string };
    expect(unlinked.success).toBe(true);
    expect(unlinked.message).toBe('Space "Source" no longer links "Target".');
  });

  it("links to the active space when spaceIn is absent, and refuses Default as the owner", async () => {
    const linked = (await spaceCall({ spaceAction: "link", spaceName: "Target" })) as {
      success: boolean;
      message?: string;
    };
    expect(linked.success).toBe(true);
    expect(linked.message).toBe('Space "Aizat" now links "Target".');
    await spaceCall({ spaceAction: "unlink", spaceName: "Target" });
    const refused = (await spaceCall({
      spaceAction: "link",
      spaceName: "Target",
      spaceIn: "Default",
    })) as { success: boolean; error: string };
    expect(refused.success).toBe(false);
    expect(refused.error).toBe("The Default space cannot link other spaces.");
  });

  it("refuses a move and says only the web app can move memories", async () => {
    const result = (await spaceCall({
      spaceAction: "move",
      spaceName: "Source",
      spaceTo: "Target",
    })) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("Only the web app can move memories between spaces.");
  });

  it("refuses export and import for the tool", async () => {
    const exportRefused = (await spaceCall({ spaceAction: "export", spaceName: "Source" })) as {
      success: boolean;
      error: string;
    };
    expect(exportRefused.success).toBe(false);
    expect(exportRefused.error).toBe(
      "The memory tool cannot export a space. Use the web app or the CLI."
    );
    const importRefused = (await spaceCall({ spaceAction: "import", spaceName: "New" })) as {
      success: boolean;
      error: string;
    };
    expect(importRefused.success).toBe(false);
    expect(importRefused.error).toBe(
      "The memory tool cannot import a space. Use the web app or the CLI."
    );
  });
});
