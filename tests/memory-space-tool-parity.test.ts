import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig } from "../src/config.js";
import ommsPiExtension from "../src/adapters/pi/extension.js";
import { memoryInput } from "../src/v2/adapter.js";
import {
  INPUT_SCHEMA as claudeSpaceSchema,
  memoryArgs as claudeMemoryArgs,
} from "../hooks/omms-memory-tool.jsx";

const omms = join(homedir(), ".omms");
let project: string;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-space-parity-"));
  initConfig(project);
});
afterAll(() => {
  rmSync(join(omms, "spaces.json"), { force: true });
  rmSync(join(omms, "spaces"), { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

const noop = () => undefined;
const loose = (): any => new Proxy(noop, { get: () => loose(), apply: () => undefined });

/** The `memory` tool Pi registers, captured from the real extension. */
function piMemoryTool(): any {
  let tool: any;
  const pi = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "registerTool"
          ? (definition: any) => {
              if (definition.name === "memory") tool = definition;
            }
          : loose(),
    }
  );
  ommsPiExtension(pi as never);
  return tool;
}

describe("the space mode is the same on every host", () => {
  it("Pi accepts the space mode and runs it", async () => {
    const tool = piMemoryTool();
    const modes = tool.parameters.properties.mode.anyOf.map((entry: any) => entry.const);
    expect(modes).toContain("space");
    expect(Object.keys(tool.parameters.properties)).toEqual(
      expect.arrayContaining(["spaceAction", "spaceName"])
    );
    const created = await tool.execute(
      "call-1",
      { mode: "space", spaceAction: "create", spaceName: "Pi space" },
      undefined,
      undefined,
      { cwd: project, sessionManager: { getSessionId: () => "pi-1" } }
    );
    expect(JSON.parse(created.content[0].text)).toMatchObject({ success: true });
    const refused = await tool.execute(
      "call-2",
      { mode: "space", spaceAction: "delete", spaceName: "Pi space" },
      undefined,
      undefined,
      { cwd: project, sessionManager: { getSessionId: () => "pi-1" } }
    );
    expect(JSON.parse(refused.content[0].text).error).toBe("Only the web app can delete a space.");
  });

  it("OpenCode V2 accepts the space mode and its two fields", () => {
    expect(memoryInput.properties.mode.enum).toContain("space");
    expect(Object.keys(memoryInput.properties)).toEqual(
      expect.arrayContaining(["spaceAction", "spaceName"])
    );
  });
});

const TRANSFER_ARGS = ["spaceTo", "spaceSince", "spaceUntil", "spaceProject", "spaceIn"];

describe("the space transfer actions are the same on every host", () => {
  it("Pi carries the transfer arguments and runs a preview with them", async () => {
    const tool = piMemoryTool();
    expect(Object.keys(tool.parameters.properties)).toEqual(expect.arrayContaining(TRANSFER_ARGS));
    await tool.execute(
      "call-create",
      { mode: "space", spaceAction: "create", spaceName: "Pi two" },
      undefined,
      undefined,
      { cwd: project, sessionManager: { getSessionId: () => "pi-1" } }
    );
    const preview = JSON.parse(
      (
        await tool.execute(
          "call-preview",
          {
            mode: "space",
            spaceAction: "preview",
            spaceName: "Pi space",
            spaceTo: "Pi two",
            spaceSince: "2026-10-01",
            spaceUntil: "2026-11-01",
          },
          undefined,
          undefined,
          { cwd: project, sessionManager: { getSessionId: () => "pi-1" } }
        )
      ).content[0].text
    );
    expect(preview).toMatchObject({ success: true, preview: { matched: 0 } });
  });

  it("OpenCode V2 carries the transfer arguments", () => {
    expect(memoryInput.properties.mode.enum).toContain("space");
    expect(Object.keys(memoryInput.properties)).toEqual(expect.arrayContaining(TRANSFER_ARGS));
    for (const key of TRANSFER_ARGS) {
      expect(memoryInput.properties[key]).toEqual({ type: "string" });
    }
  });

  it("the Claude Code tool carries the transfer fields and maps them onto the space command", () => {
    for (const key of ["to", "since", "until", "project", "in"]) {
      expect(claudeSpaceSchema.properties[key]?.type).toBe("string");
    }
    expect(
      claudeMemoryArgs({
        mode: "space",
        action: "preview",
        name: "A",
        to: "B",
        since: "2026-10-01",
      }).args
    ).toEqual(["space", "preview", "A", "--to", "B", "--since", "2026-10-01"]);
    expect(claudeMemoryArgs({ mode: "space", action: "link", name: "B", in: "A" }).args).toEqual([
      "space",
      "link",
      "B",
      "--in",
      "A",
    ]);
    // Without the new fields the call keeps today's shape, so the shared
    // command refuses move, export and import with its own messages.
    expect(claudeMemoryArgs({ mode: "space", action: "use", name: "X" }).args).toEqual([
      "memory",
      "space",
      "--action",
      "use",
      "--name",
      "X",
    ]);
    expect(claudeMemoryArgs({ mode: "space", action: "export", name: "A" }).args).toEqual([
      "memory",
      "space",
      "--action",
      "export",
      "--name",
      "A",
    ]);
    expect(claudeMemoryArgs({ mode: "space", action: "move", name: "A", to: "B" }).args).toEqual([
      "space",
      "move",
      "A",
      "--to",
      "B",
    ]);
  });

  it("Pi refuses move, export and import with the shared messages", async () => {
    const tool = piMemoryTool();
    const call = async (args: Record<string, string>) =>
      JSON.parse(
        (
          await tool.execute("call-refuse", { mode: "space", ...args }, undefined, undefined, {
            cwd: project,
            sessionManager: { getSessionId: () => "pi-1" },
          })
        ).content[0].text
      );
    expect((await call({ spaceAction: "move", spaceName: "A", spaceTo: "B" })).error).toBe(
      "Only the web app can move memories between spaces."
    );
    expect((await call({ spaceAction: "export", spaceName: "A" })).error).toBe(
      "The memory tool cannot export a space. Use the web app or the CLI."
    );
    expect((await call({ spaceAction: "import", spaceName: "A" })).error).toBe(
      "The memory tool cannot import a space. Use the web app or the CLI."
    );
  });
});
