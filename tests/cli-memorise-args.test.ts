import { describe, expect, it } from "bun:test";
import { memoryCommandUsage, parseMemoryCommandArgs } from "../src/cli/memory-command.js";

describe("om-memory-system memory memorise and recall: argument parsing", () => {
  it("maps a positional text onto content for memorise and memorize", () => {
    for (const mode of ["memorise", "memorize"]) {
      const parsed = parseMemoryCommandArgs([mode, "Exact text to keep"]);
      expect(parsed.help).toBe(false);
      expect(parsed.args).toEqual({ mode, content: "Exact text to keep" });
    }
  });

  it("accepts --content and the snapshot flags, and keeps --tags", () => {
    const parsed = parseMemoryCommandArgs([
      "memorise",
      "--topic",
      "Auth",
      "--done",
      "Login form",
      "--doing",
      "Token refresh",
      "--next",
      "Tests",
      "--tags",
      "auth,wip",
    ]);
    expect(parsed.args).toEqual({
      mode: "memorise",
      topic: "Auth",
      done: "Login form",
      doing: "Token refresh",
      next: "Tests",
      tags: "auth,wip",
    });
  });

  it("returns --session-id as the host session ID, not as an operation argument", () => {
    const parsed = parseMemoryCommandArgs(["memorise", "--topic", "T", "--session-id", "abc-123"]);
    expect(parsed.hostSessionId).toBe("abc-123");
    expect(parsed.args).not.toHaveProperty("sessionId");
    expect(parsed.args).not.toHaveProperty("hostSessionId");
    expect(parseMemoryCommandArgs(["memorise", "x"]).hostSessionId).toBeUndefined();
  });

  it("maps recall's positional onto query, for an ID or for text", () => {
    expect(parseMemoryCommandArgs(["recall", "ms-4k7q2p"]).args).toEqual({
      mode: "recall",
      query: "ms-4k7q2p",
    });
    expect(parseMemoryCommandArgs(["recall", "auth refresh", "--limit", "2"]).args).toEqual({
      mode: "recall",
      query: "auth refresh",
      limit: 2,
    });
  });

  it("keeps --tags on recall, with or without a query", () => {
    expect(parseMemoryCommandArgs(["recall", "--tags", "Auth,WIP"]).args).toEqual({
      mode: "recall",
      tags: "Auth,WIP",
    });
    expect(parseMemoryCommandArgs(["recall", "--tags", "auth", "token refresh"]).args).toEqual({
      mode: "recall",
      query: "token refresh",
      tags: "auth",
    });
  });

  it("refuses a second positional, or a positional beside its flag", () => {
    expect(() => parseMemoryCommandArgs(["memorise", "a", "b"])).toThrow('Unexpected argument "a"');
    expect(() => parseMemoryCommandArgs(["memorise", "a", "--content", "b"])).toThrow(
      'Unexpected argument "a"'
    );
    expect(() => parseMemoryCommandArgs(["recall", "a", "b"])).toThrow('Unexpected argument "a"');
    expect(() => parseMemoryCommandArgs(["recall", "a", "--query", "b"])).toThrow(
      'Unexpected argument "a"'
    );
  });

  it("lists the new modes and flags in the usage text", () => {
    for (const mode of ["memorise", "memorize", "recall"]) {
      expect(memoryCommandUsage).toMatch(new RegExp(`^\\s+${mode}\\s`, "m"));
    }
    for (const flag of ["--topic", "--done", "--doing", "--next", "--session-id"]) {
      expect(memoryCommandUsage).toContain(flag);
    }
    // --tags works for recall as well as add and memorise.
    expect(memoryCommandUsage).toMatch(/--tags <a,b>[^\n]*\(add, memorise, recall\)/);
    expect(memoryCommandUsage).toContain("memory recall --tags");
  });

  it("describes recall by label in the mode list", () => {
    expect(memoryCommandUsage).toMatch(/^\s+recall\s.*label/im);
  });
});
