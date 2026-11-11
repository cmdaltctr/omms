import { describe, expect, it } from "bun:test";
import {
  INTERNAL_CAPTURE_SESSION_TITLE,
  isInternalCaptureSessionTitle,
} from "../src/adapters/opencode/internal-capture-sessions.js";
import { isStructuredSummaryPromptMessage } from "../src/adapters/opencode/user-prompt.js";

describe("structured summary prompt filter", () => {
  it("identifies the plugin's own structured-summary prompt echo", () => {
    expect(
      isStructuredSummaryPromptMessage(
        'Analyze this conversation. Return type="skip" for no memory.'
      )
    ).toBe(true);
  });

  it("identifies the plugin's own user-profile analysis prompt echo", () => {
    expect(
      isStructuredSummaryPromptMessage(
        "# User Profile Analysis\n\nAnalyze 10 user prompts to update the user profile."
      )
    ).toBe(true);
  });

  it("does not filter ordinary user messages", () => {
    expect(isStructuredSummaryPromptMessage("Analyze this conversation in the bug report.")).toBe(
      false
    );
    expect(isStructuredSummaryPromptMessage("Please update my user profile preferences.")).toBe(
      false
    );
  });
});

describe("internal capture session title", () => {
  it("matches the transient structured-output session title", () => {
    expect(isInternalCaptureSessionTitle(INTERNAL_CAPTURE_SESSION_TITLE)).toBe(true);
    expect(isInternalCaptureSessionTitle("opencode-mem capture")).toBe(true);
  });

  it("does not match ordinary session titles", () => {
    expect(isInternalCaptureSessionTitle("My coding session")).toBe(false);
    expect(isInternalCaptureSessionTitle("")).toBe(false);
    expect(isInternalCaptureSessionTitle(undefined)).toBe(false);
    expect(isInternalCaptureSessionTitle(null)).toBe(false);
  });
});
