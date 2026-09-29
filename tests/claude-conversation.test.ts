import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractClaudeConversationWindows,
  extractClaudeWindowsAfter,
  parseClaudeTranscript,
  parseClaudeTranscriptLine,
  type ClaudeTranscriptEntry,
} from "../src/importer/claude-conversation.js";

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "claude-transcripts");
const MAIN_FIXTURE = join(
  FIXTURE_ROOT,
  "-tmp-claude-fixture-project",
  "11111111-1111-4111-8111-111111111111.jsonl"
);

function loadFixture() {
  return parseClaudeTranscript(readFileSync(MAIN_FIXTURE, "utf8"));
}

function fixtureWindows() {
  return extractClaudeConversationWindows(loadFixture().entries);
}

function user(uuid: string, content: unknown): ClaudeTranscriptEntry {
  return {
    type: "user",
    uuid,
    timestamp: "2026-01-01T10:00:00.000Z",
    cwd: "/tmp/claude-fixture-project",
    message: { role: "user", content },
  } as ClaudeTranscriptEntry;
}

function assistant(uuid: string, blocks: any[]): ClaudeTranscriptEntry {
  return {
    type: "assistant",
    uuid,
    timestamp: "2026-01-01T10:00:05.000Z",
    message: { role: "assistant", content: blocks },
  } as ClaudeTranscriptEntry;
}

describe("parseClaudeTranscriptLine", () => {
  it("classifies each kind of line", () => {
    expect(parseClaudeTranscriptLine("   ")).toEqual({ status: "blank" });
    expect(parseClaudeTranscriptLine("not json")).toEqual({ status: "unreadable" });
    expect(parseClaudeTranscriptLine("[1,2]")).toEqual({ status: "unreadable" });
    expect(parseClaudeTranscriptLine('{"uuid":"no-type"}')).toEqual({ status: "unreadable" });
    expect(parseClaudeTranscriptLine('{"type":"fixture-new-kind"}')).toEqual({
      status: "unknown-type",
    });
    const parsed = parseClaudeTranscriptLine('{"type":"user","uuid":"u"}');
    expect(parsed.status).toBe("entry");
    if (parsed.status === "entry") expect(parsed.entry.uuid).toBe("u");
  });
});

describe("parseClaudeTranscript", () => {
  it("counts the broken line and the unknown entry type and keeps the rest", () => {
    const parsed = loadFixture();
    expect(parsed.unreadableLines).toBe(1);
    expect(parsed.unknownTypes).toBe(1);
    // 29 lines, less one broken line and one unknown type.
    expect(parsed.entries.length).toBe(27);
    expect(parsed.entries.some((entry) => entry.uuid === "broken-line")).toBe(false);
    expect(parsed.entries.some((entry) => entry.uuid === "unknown-1")).toBe(false);
  });
});

describe("extractClaudeConversationWindows", () => {
  it("returns one window per real prompt that got assistant work, oldest first", () => {
    const windows = fixtureWindows();
    expect(windows.map((window) => window.userEntryId)).toEqual(["u1", "u2", "u3"]);
  });

  it("reads a string prompt, a text-block prompt, and a slash command", () => {
    const [first, second, third] = fixtureWindows();
    expect(first!.userPrompt).toBe("Explain the fixture build layout.");
    expect(second!.userPrompt).toBe("Run the three checks and report.");
    expect(third!.userPrompt).toBe("/fixture-skill tidy notes");
  });

  it("collects assistant text into textResponses", () => {
    const windows = fixtureWindows();
    expect(windows.map((window) => window.textResponses)).toEqual([
      ["The fixture uses one folder per project."],
      ["All three checks passed."],
      ["Notes tidied."],
    ]);
  });

  it("returns one unit with the prompt, the reply, and the three tool calls with bounded inputs", () => {
    const window = fixtureWindows()[1]!;
    expect(window.toolCalls).toEqual([
      { name: "Bash", input: 'command: "bun run check", description: "Run the checks"' },
      { name: "Read", input: 'file_path: "/tmp/claude-fixture-project/README.md"' },
      {
        name: "Grep",
        input: `pattern: "fixture-${"x".repeat(150)}"`.slice(0, 100) + "...",
      },
    ]);
  });

  it("lists the user uuid and every assistant uuid as source entry ids", () => {
    const windows = fixtureWindows();
    expect(windows[0]!.sourceEntryIds).toEqual(["u1", "a1-thinking", "a1-text"]);
    expect(windows[1]!.sourceEntryIds).toEqual([
      "u2",
      "a2-thinking",
      "a2-bash",
      "a2-read",
      "a2-grep",
      "a2-final",
    ]);
    expect(windows[2]!.sourceEntryIds).toEqual(["u3", "a3-text"]);
  });

  it("takes timestamps and the project directory from the user entry", () => {
    const window = fixtureWindows()[1]!;
    const expected = Date.parse("2026-03-01T10:05:00.000Z");
    expect(window.userTimestamp).toBe(expected);
    expect(window.sourceTimestamp).toBe(expected);
    expect(window.cwd).toBe("/tmp/claude-fixture-project");
  });

  it("skips sidechain entries without ending the parent turn", () => {
    const windows = fixtureWindows();
    const text = JSON.stringify(windows);
    expect(text).not.toContain("SIDECHAIN");
    expect(text).not.toContain("side-");
    expect(windows[1]!.textResponses).toEqual(["All three checks passed."]);
  });

  it("skips meta entries without ending the turn", () => {
    const windows = fixtureWindows();
    expect(windows.some((window) => window.userEntryId.startsWith("meta-"))).toBe(false);
    expect(JSON.stringify(windows)).not.toContain("SKILL BODY EXPANSION");
    // The meta reminder sits between the first and second tool call.
    expect(windows[1]!.toolCalls.map((call) => call.name)).toContain("Read");
  });

  it("never turns tool results into prompts and keeps the turn open across them", () => {
    const windows = fixtureWindows();
    expect(windows.some((window) => window.userEntryId.startsWith("tr-"))).toBe(false);
    expect(JSON.stringify(windows)).not.toContain("TOOL RESULT");
    expect(windows[1]!.toolCalls.length).toBe(3);
  });

  it("drops thinking blocks", () => {
    expect(JSON.stringify(fixtureWindows())).not.toContain("HIDDEN THINKING");
  });

  it("ends a turn at a task notification without starting a new one", () => {
    const windows = fixtureWindows();
    expect(windows.some((window) => window.userEntryId === "u4")).toBe(false);
    expect(JSON.stringify(windows)).not.toContain("BACKGROUND TASK REPLY");
  });

  it("ends a turn at local command output without starting a new one", () => {
    const windows = extractClaudeConversationWindows([
      user("p1", "Do the thing"),
      assistant("r1", [{ type: "text", text: "Done" }]),
      user("noise", "<local-command-stdout>ok</local-command-stdout>"),
      assistant("stray", [{ type: "text", text: "Stray reply" }]),
    ]);
    expect(windows.length).toBe(1);
    expect(windows[0]!.textResponses).toEqual(["Done"]);
    expect(windows[0]!.sourceEntryIds).toEqual(["p1", "r1"]);
  });

  it("skips a prompt with no reply and a prompt with only thinking", () => {
    expect(fixtureWindows().some((window) => window.userEntryId === "u5")).toBe(false);
    expect(
      extractClaudeConversationWindows([
        user("p1", "Think only"),
        assistant("r1", [{ type: "thinking", thinking: "hidden" }]),
      ])
    ).toEqual([]);
  });
});

describe("extractClaudeWindowsAfter", () => {
  it("returns only the last window without a cursor", () => {
    const entries = loadFixture().entries;
    expect(extractClaudeWindowsAfter(entries, null).map((window) => window.userEntryId)).toEqual([
      "u3",
    ]);
  });

  it("returns every window after the cursor", () => {
    const entries = loadFixture().entries;
    expect(extractClaudeWindowsAfter(entries, "u1").map((window) => window.userEntryId)).toEqual([
      "u2",
      "u3",
    ]);
    expect(extractClaudeWindowsAfter(entries, "u3")).toEqual([]);
  });

  it("falls back to the last window when the cursor is not in the transcript", () => {
    const entries = loadFixture().entries;
    expect(
      extractClaudeWindowsAfter(entries, "missing").map((window) => window.userEntryId)
    ).toEqual(["u3"]);
  });
});
