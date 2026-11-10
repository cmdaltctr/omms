import { describe, expect, it } from "bun:test";
import {
  memoriseCallState,
  memoriseResultState,
  turnSavedMemorisation,
} from "../src/core/memorise-turn.js";
import type { CaptureToolCall } from "../src/core/host.js";

// The shared detector behind "automatic capture skips a turn that saved a
// memorisation". Readers set `memorise` on each tool call from the raw args and
// the result. The detector reads only that field.

const call = (memorise?: CaptureToolCall["memorise"]): CaptureToolCall => ({
  name: "memory",
  input: "",
  ...(memorise ? { memorise } : {}),
});

describe("memoriseCallState", () => {
  it("marks a memory tool call in memorise mode and its memorize alias", () => {
    expect(memoriseCallState("memory", { mode: "memorise", content: "x" })).toBe("unknown");
    expect(memoriseCallState("memory", { mode: "memorize", content: "x" })).toBe("unknown");
    expect(memoriseCallState("memory", { mode: "Memorise" })).toBe("unknown");
  });

  it("reads the Claude Code plugin tool names", () => {
    expect(memoriseCallState("mcp__omms__memory", { mode: "memorise" })).toBe("unknown");
    expect(memoriseCallState("mcp__omms-visible__memory", { mode: "memorize" })).toBe("unknown");
  });

  it("reads args given as a JSON string", () => {
    expect(memoriseCallState("memory", '{"mode":"memorise","topic":"t"}')).toBe("unknown");
  });

  it("ignores other memory modes and a call with no mode", () => {
    for (const mode of ["add", "recall", "search", "list", "forget", "help", "profile"]) {
      expect(memoriseCallState("memory", { mode })).toBeUndefined();
    }
    expect(memoriseCallState("memory", { content: "x" })).toBeUndefined();
    expect(memoriseCallState("memory", undefined)).toBeUndefined();
    expect(memoriseCallState("memory", "not json")).toBeUndefined();
  });

  it("ignores a tool that is not the OMMS memory tool", () => {
    expect(memoriseCallState("mcp__other__memory", { mode: "memorise" })).toBeUndefined();
    expect(memoriseCallState("remember", { mode: "memorise" })).toBeUndefined();
    expect(memoriseCallState("read", { mode: "memorise" })).toBeUndefined();
  });

  it("marks a Bash call to the om-memory-system memorise command", () => {
    const run = (name: string, command: string) => memoriseCallState(name, { command });
    expect(run("Bash", 'om-memory-system memory memorise "state of play"')).toBe("unknown");
    expect(run("bash", "om-memory-system memory memorize --topic Auth --next Tests")).toBe(
      "unknown"
    );
    expect(run("Bash", "npx -y om-memory-system memory memorise --content x")).toBe("unknown");
  });

  it("ignores other Bash commands", () => {
    const run = (command: string) => memoriseCallState("Bash", { command });
    expect(run("om-memory-system memory recall ms-abc123")).toBeUndefined();
    expect(run("om-memory-system memory add --content memorise")).toBeUndefined();
    expect(run("echo memory memorise")).toBeUndefined();
    expect(run("ls -la")).toBeUndefined();
    expect(memoriseCallState("Bash", { command: 42 })).toBeUndefined();
  });
});

describe("memoriseResultState", () => {
  it("is saved for a successful JSON reply", () => {
    expect(memoriseResultState(false, '{"success":true,"id":"ms-ke8zw6"}')).toBe("saved");
  });

  it("is failed when the reply says success false, even with no host error", () => {
    expect(memoriseResultState(false, '{"success":false,"error":"content required"}')).toBe(
      "failed"
    );
  });

  it("is failed when the host marks the result as an error", () => {
    expect(memoriseResultState(true, "")).toBe("failed");
    expect(memoriseResultState(true, '{"success":true}')).toBe("failed");
  });

  it("is saved for a reply that is not JSON and not an error", () => {
    expect(memoriseResultState(false, "")).toBe("saved");
    expect(memoriseResultState(false, "Saved as ms-1")).toBe("saved");
  });
});

describe("turnSavedMemorisation", () => {
  it("is true when one call saved a memorisation", () => {
    expect(turnSavedMemorisation([call(), call("saved")])).toBe(true);
  });

  it("is false for a failed or unanswered memorise call", () => {
    expect(turnSavedMemorisation([call("failed")])).toBe(false);
    expect(turnSavedMemorisation([call("unknown")])).toBe(false);
  });

  it("is false for an ordinary turn and for no tool calls", () => {
    expect(turnSavedMemorisation([call(), call()])).toBe(false);
    expect(turnSavedMemorisation([])).toBe(false);
  });
});
