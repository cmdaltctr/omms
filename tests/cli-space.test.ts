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
    expect(result.out).toBe("Default (default) [active]");
  });

  it("creates, switches, archives and unarchives", async () => {
    const created = JSON.parse((await run("create", "Experiments")).out);
    expect(created.space.id).toMatch(/^space-[a-z0-9]{10}$/);
    expect((await run("create", "Spike")).code).toBe(0);
    const used = JSON.parse((await run("use", "Experiments")).out);
    expect(used.activeSpace.id).toBe(created.space.id);
    expect((await run("archive", "Spike")).code).toBe(0);
    expect((await run("unarchive", "Spike")).code).toBe(0);
    expect(JSON.parse((await run("status")).out).activeSpace.id).toBe(created.space.id);
  });

  it("exits 1 and lists valid spaces when the switch is refused", async () => {
    await run("archive", "Spike");
    const result = await run("use", "Spike");
    expect(result.code).toBe(1);
    const error = JSON.parse(result.out).error as string;
    expect(error).toContain("Spaces that can become active");
    expect(error).toContain("Default (default)");
    expect(error).toMatch(/Experiments \(space-[a-z0-9]{10}\)/);
    expect(error).not.toMatch(/Spike \(/);
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

  it("lists each space by display name, with the id after it", async () => {
    const work = JSON.parse((await run("create", "Work")).out);
    const old = JSON.parse((await run("create", "Old")).out);
    await run("use", "Work");
    await run("archive", "Old");
    const result = await run("list");
    expect(result.code).toBe(0);
    const lines = result.out.split("\n");
    expect(lines.find((line) => line.startsWith("Work ("))).toBe(
      `Work (${work.space.id}) [active]`
    );
    expect(lines.find((line) => line.startsWith("Old ("))).toBe(`Old (${old.space.id}) [archived]`);
    expect(lines).toContain("Default (default)");
    expect(lines.filter((line) => line.includes("[active]"))).toHaveLength(1);
    for (const line of lines) {
      expect(line).toMatch(/^.+ \([a-z0-9-]+\)( \[(active|archived)\])?$/);
    }
  });

  it("names a space by display name when the caller passed the id", async () => {
    const created = JSON.parse((await run("create", "By id")).out);
    const archived = JSON.parse((await run("archive", created.space.id)).out);
    expect(archived.message).toBe('Space "By id" is now archived.');
    const back = JSON.parse((await run("unarchive", created.space.id)).out);
    expect(back.message).toBe('Space "By id" is now not archived.');
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
    const listed = await run("list");
    expect(listed.out.split("\n").some((line) => line.startsWith("From file ("))).toBe(false);
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
