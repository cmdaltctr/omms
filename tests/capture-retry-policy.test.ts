import { describe, expect, it } from "bun:test";
import {
  CAPTURE_RETRY_LATER_WAIT_MS,
  captureRetryDelayMs,
  classifyCaptureFailure,
  errorHttpStatus,
  errorRetryAfterMs,
  httpStatusError,
  parseRetryAfter,
} from "../src/core/capture-retry-policy.js";

describe("classifyCaptureFailure", () => {
  it("retries a model call with no status (network failure or timeout)", () => {
    expect(classifyCaptureFailure({ reason: "call-error" })).toBe("retryable");
  });

  it.each([408, 429, 500, 502, 503, 504])("retries a model call with HTTP %d", (httpStatus) => {
    expect(classifyCaptureFailure({ reason: "call-error", httpStatus })).toBe("retryable");
  });

  it.each([400, 401, 403, 404, 422])("does not retry a model call with HTTP %d", (httpStatus) => {
    expect(classifyCaptureFailure({ reason: "call-error", httpStatus })).toBe("permanent");
  });

  it("retries a failed write to the local store", () => {
    expect(classifyCaptureFailure({ reason: "persist-error" })).toBe("retryable");
  });

  it.each(["empty-text", "truncated", "invalid-json", "schema-mismatch"] as const)(
    "does not retry a bad reply (%s)",
    (reason) => {
      expect(classifyCaptureFailure({ reason })).toBe("permanent");
      expect(classifyCaptureFailure({ reason, httpStatus: 503 })).toBe("permanent");
    }
  );
});

describe("captureRetryDelayMs", () => {
  const noJitter = () => 0;
  const fullJitter = () => 1;

  it("waits 1 min, 5 min, 30 min and 2 h after the first four failed tries", () => {
    expect(captureRetryDelayMs(1, undefined, noJitter)).toBe(60_000);
    expect(captureRetryDelayMs(2, undefined, noJitter)).toBe(300_000);
    expect(captureRetryDelayMs(3, undefined, noJitter)).toBe(1_800_000);
    expect(captureRetryDelayMs(4, undefined, noJitter)).toBe(7_200_000);
  });

  it("waits 12 hours after every later try", () => {
    expect(captureRetryDelayMs(5, undefined, noJitter)).toBe(CAPTURE_RETRY_LATER_WAIT_MS);
    expect(captureRetryDelayMs(40, undefined, noJitter)).toBe(CAPTURE_RETRY_LATER_WAIT_MS);
  });

  it("adds at most 20 % random extra wait", () => {
    expect(captureRetryDelayMs(1, undefined, fullJitter)).toBe(72_000);
    const delay = captureRetryDelayMs(2);
    expect(delay).toBeGreaterThanOrEqual(300_000);
    expect(delay).toBeLessThanOrEqual(360_000);
  });

  it("never retries before a Retry-After value", () => {
    expect(captureRetryDelayMs(1, 600_000, fullJitter)).toBe(600_000);
    expect(captureRetryDelayMs(1, 1_000, noJitter)).toBe(60_000);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("Mon, 28 Sep 2026 12:05:00 GMT", now)).toBe(300_000);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe("error status helpers", () => {
  it("reads a status and Retry-After from an error or its cause", () => {
    const inner = httpStatusError("rate limited", 429, 30_000);
    const outer = new Error("Summary generation failed", { cause: inner });
    expect(errorHttpStatus(outer)).toBe(429);
    expect(errorRetryAfterMs(outer)).toBe(30_000);
    expect(errorHttpStatus(new Error("plain"))).toBeUndefined();
  });
});
