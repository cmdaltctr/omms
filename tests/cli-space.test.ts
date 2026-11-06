import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig } from "../src/config.js";
import { parseMemoryCommandArgs } from "../src/cli/memory-command.js";
import { runSpaceCommand, spaceCommandUsage } from "../src/cli/space-command.js";

const omms = join(homedir(), ".omms");
let project: string;

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSpaceCommand(argv, {
    cwd: project,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-cli-space-"));
  initConfig(project);
});
afterAll(() => {
  rmSync(join(omms, "spaces.json"), { force: true });
  rmSync(join(omms, "spaces"), { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

describe("om-memory-system space", () => {
  it("prints help", async () => {
    const result = await run("--help");
    expect(result.code).toBe(0);
    expect(result.out).toBe(spaceCommandUsage);
    expect(spaceCommandUsage).not.toMatch(/^\s+delete\s/m);
  });

  it("lists Default as the only space at first", async () => {
    const result = await run("list");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ spaces: [{ id: "default", active: true }] });
  });

  it("creates, switches, archives and unarchives", async () => {
    expect((await run("create", "Experiments")).code).toBe(0);
    expect((await run("create", "Spike")).code).toBe(0);
    const used = JSON.parse((await run("use", "Experiments")).out);
    expect(used.activeSpace.id).toBe("experiments");
    expect((await run("archive", "Spike")).code).toBe(0);
    expect((await run("unarchive", "Spike")).code).toBe(0);
    expect(JSON.parse((await run("status")).out).activeSpace.id).toBe("experiments");
  });

  it("exits 1 and lists valid spaces when the switch is refused", async () => {
    await run("archive", "Spike");
    const result = await run("use", "Spike");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).error).toContain("Spaces that can become active");
  });

  it("exits 1 when archiving the active space", async () => {
    const result = await run("archive", "Experiments");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).error).toContain("Switch to another space first");
  });

  it("has no delete and says only the web app can delete a space", async () => {
    const result = await run("delete", "Spike");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).error).toBe("Only the web app can delete a space.");
  });

  it("rejects an unknown action with the usage text", async () => {
    const result = await run("explode");
    expect(result.code).toBe(1);
    expect(result.err).toContain("Usage: om-memory-system space");
  });
});

describe("om-memory-system memory space", () => {
  it("parses the space mode with an action and a name", () => {
    expect(parseMemoryCommandArgs(["space", "use", "Experiments"]).args).toEqual({
      mode: "space",
      spaceAction: "use",
      spaceName: "Experiments",
    });
    expect(parseMemoryCommandArgs(["space", "--action", "list"]).args).toEqual({
      mode: "space",
      spaceAction: "list",
    });
  });

  it("still refuses extra arguments for other modes", () => {
    expect(() => parseMemoryCommandArgs(["list", "extra"])).toThrow(/Unexpected argument/);
  });
});
