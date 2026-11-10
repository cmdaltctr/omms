import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig } from "../src/config.js";
import { memoryToolDescription } from "../src/core/memory-tool-text.js";
import ommsPiExtension from "../src/adapters/pi/extension.js";
import { opencodeMemoryTool } from "../src/adapters/opencode/memory-tool.js";
import { memoryInput } from "../src/v2/adapter.js";
import { memoryArgs as claudeMemoryArgs, DESCRIPTION } from "../hooks/omms-memory-tool.jsx";

/**
 * Recall by label is the same on every host: the `memory` tool of OpenCode, Pi and Claude Code
 * accepts `tags` for `recall`, and the shared description says so. The CLI is covered in
 * cli-memory.test.ts. Pi and OpenCode run against the real store.
 */

let project: string;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-labels-parity-"));
  initConfig(project);
});
afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

const noop = () => undefined;
const loose = (): any => new Proxy(noop, { get: () => loose(), apply: () => undefined });

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

describe("recall by label on every host", () => {
  it("names the tags argument for recall in the shared description and the Claude Code one", () => {
    expect(memoryToolDescription("English")).toContain("labels");
    expect(memoryToolDescription("English")).toContain("tags");
    expect(DESCRIPTION).toContain('mode "recall" (query, tags, limit)');
  });

  it("accepts tags in the OpenCode V2 schema and the OpenCode tool", () => {
    expect(memoryInput.properties.tags).toBeDefined();
    const tool = opencodeMemoryTool("d", { directory: project });
    expect(Object.keys(tool.args)).toContain("tags");
  });

  it("memorises with labels and recalls by label through the OpenCode tool", async () => {
    const tool = opencodeMemoryTool("d", { directory: project });
    const run = async (args: Record<string, unknown>) =>
      JSON.parse(await tool.execute(args as never, { sessionID: "s1" } as never));
    const saved = await run({
      mode: "memorise",
      content: "opencode labelled note",
      tags: "Parity",
    });
    const found = await run({ mode: "recall", tags: "parity" });
    expect(found.matches.map((match: any) => match.id)).toEqual([saved.id]);
    expect(found.matches[0].tags).toEqual(["parity"]);
  }, 60_000);

  it("accepts tags in the Pi tool and recalls by label with no query", async () => {
    const tool = piMemoryTool();
    expect(Object.keys(tool.parameters.properties)).toContain("tags");
    const call = async (args: Record<string, unknown>) =>
      JSON.parse(
        (
          await tool.execute("c", args, undefined, undefined, {
            cwd: project,
            sessionManager: { getSessionId: () => "pi-1" },
          })
        ).content[0].text
      );
    const saved = await call({ mode: "memorise", content: "pi labelled note", tags: "PiLabel" });
    const found = await call({ mode: "recall", tags: "pilabel" });
    expect(found.matches.map((match: any) => match.id)).toEqual([saved.id]);
  }, 60_000);

  it("maps tags for recall in Claude Code, and refuses a recall with neither query nor tags", () => {
    expect(claudeMemoryArgs({ mode: "recall", tags: "a, b" }).args).toEqual([
      "memory",
      "recall",
      "--tags",
      "a, b",
    ]);
    expect(claudeMemoryArgs({ mode: "recall" })).toEqual({
      error: "recall needs a query or tags.",
    });
    expect(claudeMemoryArgs({ mode: "search", query: "x", tags: "a" }).args).toEqual([
      "memory",
      "search",
      "--query",
      "x",
    ]);
  });
});
