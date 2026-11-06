import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, getActiveSpace, initConfig } from "../src/config.js";
import { executeMemoryOperation } from "../src/core/memory-operations.js";

const omms = join(homedir(), ".omms");
let project: string;
const space = (spaceAction?: string, spaceName?: string) =>
  executeMemoryOperation({ mode: "space", spaceAction, spaceName }, { directory: project });

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-tool-space-"));
  initConfig(project);
});
afterAll(() => {
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
    expect(await space("create", "Aizat")).toMatchObject({ success: true });
    expect(await space("use", "Aizat")).toMatchObject({
      success: true,
      activeSpace: { name: "Aizat" },
    });
    expect(CONFIG.storagePath).toBe(join(omms, "spaces", "aizat"));
    expect(getActiveSpace().name).toBe("Aizat");
    expect(await space("status")).toMatchObject({ activeSpace: { id: "aizat" } });
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

  it("lists the space mode in the help guide", async () => {
    const help = (await executeMemoryOperation({ mode: "help" }, { directory: project })) as {
      commands: { command: string }[];
    };
    expect(help.commands.map((c) => c.command)).toContain("space");
  });
});
