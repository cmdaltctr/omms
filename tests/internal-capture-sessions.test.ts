import { describe, expect, it } from "bun:test";
import {
  INTERNAL_CAPTURE_SESSION_TITLE,
  isInternalCaptureSessionTitle,
} from "../src/adapters/opencode/internal-capture-sessions.js";

describe("internal capture session title", () => {
  it("matches the shared capture title constant", () => {
    expect(INTERNAL_CAPTURE_SESSION_TITLE).toBe("omms capture");
    expect(isInternalCaptureSessionTitle(INTERNAL_CAPTURE_SESSION_TITLE)).toBe(true);
    expect(isInternalCaptureSessionTitle("other")).toBe(false);
  });

  it("still recognises sessions titled by opencode-mem builds", () => {
    expect(isInternalCaptureSessionTitle("opencode-mem capture")).toBe(true);
  });
});
