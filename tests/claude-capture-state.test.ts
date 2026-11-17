import { describe, expect, it } from "bun:test";
import { claudeCaptureState } from "../src/services/claude-capture-state.js";

const API = {
  memoryModel: "gpt-test",
  memoryApiUrl: "https://api.example.test/v1",
  memoryApiKey: "sk-real-looking-key",
};

describe("claudeCaptureState", () => {
  it("is off when auto capture is off, even with no API", () => {
    expect(claudeCaptureState({ autoCaptureEnabled: false })).toBe("off");
    expect(claudeCaptureState({ autoCaptureEnabled: false, ...API })).toBe("off");
  });

  it("is ready with a complete external API", () => {
    expect(claudeCaptureState({ autoCaptureEnabled: true, ...API })).toBe("ready");
  });

  it("needs setup with a missing key, model or URL", () => {
    for (const missing of ["memoryApiKey", "memoryModel", "memoryApiUrl"] as const) {
      const { [missing]: _gone, ...rest } = API;
      expect(claudeCaptureState({ autoCaptureEnabled: true, ...rest })).toBe("needs-setup");
    }
  });

  it("needs setup with no external API at all, because Claude Code has no session model", () => {
    expect(claudeCaptureState({ autoCaptureEnabled: true })).toBe("needs-setup");
  });

  it("does not count a host model as ready", () => {
    expect(
      claudeCaptureState({
        autoCaptureEnabled: true,
        opencodeProvider: "anthropic",
        opencodeModel: "claude-test",
      })
    ).toBe("needs-setup");
  });
});
