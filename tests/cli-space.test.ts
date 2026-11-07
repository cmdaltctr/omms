import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("om-memory-system space transfers, links and portability", () => {
  it("lists the new forms in the help text", async () => {
    const result = await run("--help");
    expect(result.code).toBe(0);
    expect(result.out).toBe(spaceCommandUsage);
    for (const word of [
      "preview",
      "copy",
      "--from",
      "--to",
      "--since",
      "--until",
      "--project",
      "link",
      "unlink",
      "--in",
      "export",
      "--out",
      "--include-profile",
      "import",
      "--retag-to-project",
    ]) {
      expect(spaceCommandUsage).toContain(word);
    }
  });

  it("previews and copies between two spaces from flags", async () => {
    expect((await run("create", "Alpha")).code).toBe(0);
    expect((await run("create", "Beta")).code).toBe(0);
    const preview = JSON.parse(
      (
        await run(
          "preview",
          "--from",
          "Alpha",
          "--to",
          "Beta",
          "--since",
          "2026-10-01",
          "--until",
          "2026-11-01"
        )
      ).out
    );
    expect(preview).toMatchObject({ success: true, preview: { matched: 0 } });
    const copy = JSON.parse((await run("copy", "--from", "Alpha", "--to", "Beta")).out);
    expect(copy).toMatchObject({ success: true, copied: 0, skipped: 0 });
  });

  it("refuses a date that is not ISO 8601", async () => {
    const result = await run("preview", "--from", "Alpha", "--to", "Beta", "--since", "not-a-date");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).error).toBe(
      'The since date "not-a-date" is not a valid ISO 8601 date.'
    );
  });

  it("refuses an unknown space, naming it", async () => {
    const result = await run("preview", "--from", "Nope", "--to", "Beta");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).error).toBe('No space named "Nope".');
  });

  it("refuses a move and says only the web app can move memories", async () => {
    const result = await run("move", "--from", "Alpha", "--to", "Beta");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).error).toBe("Only the web app can move memories between spaces.");
  });

  it("links and unlinks with --in", async () => {
    const linked = JSON.parse((await run("link", "Beta", "--in", "Alpha")).out);
    expect(linked).toMatchObject({ success: true, message: 'Space "Alpha" now links "Beta".' });
    const unlinked = JSON.parse((await run("unlink", "Beta", "--in", "Alpha")).out);
    expect(unlinked).toMatchObject({
      success: true,
      message: 'Space "Alpha" no longer links "Beta".',
    });
  });

  it("exports an empty selection without writing a file", async () => {
    const out = join(project, "alpha-export.json");
    const result = await run("export", "Alpha", "--out", out);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.out);
    expect(parsed.success).toBe(true);
    expect(parsed.export.written).toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses an import whose retag folder is missing, creating no space", async () => {
    const file = join(project, "empty-export.json");
    writeFileSync(
      file,
      JSON.stringify({
        format: "omms-space-export",
        schemaVersion: 1,
        exportedAt: "2026-11-01T00:00:00.000Z",
        ommsVersion: "test",
        embedding: { model: "probe-model", dimensions: 4 },
        memories: [],
      })
    );
    const missing = join(project, "missing-folder");
    const result = await run("import", file, "--name", "From file", "--retag-to-project", missing);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).error).toContain("does not exist, so no space was created");
    const spaces = JSON.parse((await run("list")).out);
    expect((spaces.spaces as { name: string }[]).some((space) => space.name === "From file")).toBe(
      false
    );
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
