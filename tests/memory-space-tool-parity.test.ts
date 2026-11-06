import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig } from "../src/config.js";
import ommsPiExtension from "../src/adapters/pi/extension.js";
import { memoryInput } from "../src/v2/adapter.js";

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
