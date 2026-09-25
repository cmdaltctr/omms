import { describe, expect, it } from "bun:test";
import {
  INTERNAL_CAPTURE_SESSION_TITLE,
  isInternalCaptureSessionTitle,
  isTrackedInternalCaptureSession,
  trackInternalCaptureSession,
  untrackInternalCaptureSession,
} from "../src/services/ai/internal-capture-sessions.js";

describe("internal capture session tracking", () => {
  it("tracks and untracks session ids with grace", async () => {
    const id = "ses_live170_test";
    expect(isTrackedInternalCaptureSession(id)).toBe(false);
    trackInternalCaptureSession(id);
    expect(isTrackedInternalCaptureSession(id)).toBe(true);
    untrackInternalCaptureSession(id);
    // Still tracked during grace window
    expect(isTrackedInternalCaptureSession(id)).toBe(true);
  });

  it("matches the shared capture title constant", () => {
    expect(INTERNAL_CAPTURE_SESSION_TITLE).toBe("omms capture");
    expect(isInternalCaptureSessionTitle(INTERNAL_CAPTURE_SESSION_TITLE)).toBe(true);
    expect(isInternalCaptureSessionTitle("other")).toBe(false);
  });

  it("still recognises sessions titled by opencode-mem builds", () => {
    expect(isInternalCaptureSessionTitle("opencode-mem capture")).toBe(true);
  });
});
