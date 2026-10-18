import { beforeEach, describe, expect, it, mock } from "bun:test";

const saved: string[] = [];

mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    savePrompt: async (_session: string, _message: string, _dir: string, content: string) => {
      saved.push(content);
      return "prompt-id";
    },
  },
}));

const { recordUserPrompt } = await import("../src/adapters/opencode/user-prompt.js");

describe("OpenCode recordUserPrompt privacy", () => {
  beforeEach(() => {
    saved.length = 0;
  });

  it("removes <private> text before the prompt is saved", async () => {
    const recorded = await recordUserPrompt(
      "ses_1",
      "msg_1",
      "/tmp/project",
      "Use npm here. <private>my token is abc123</private>"
    );

    expect(recorded).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toContain("abc123");
    expect(saved[0]).toContain("Use npm here.");
  });

  it("does not save a prompt that is fully private", async () => {
    const recorded = await recordUserPrompt(
      "ses_1",
      "msg_2",
      "/tmp/project",
      "<private>only secrets here</private>"
    );

    expect(recorded).toBe(false);
    expect(saved).toHaveLength(0);
  });
});
