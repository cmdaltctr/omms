import { describe, expect, it } from "bun:test";
import { captureFailureHealth, safeHealthError } from "../src/importer/settings-health.js";

describe("settings health checks", () => {
  it("passes with no failures and warns above a 20% failure rate", () => {
    expect(captureFailureHealth([{ total: 10, failed: 2 }], []).status).toBe("pass");
    expect(
      captureFailureHealth([{ total: 10, failed: 3 }], [{ reason: "model_error", count: 3 }])
    ).toEqual({
      check: "Capture failures (24 hours)",
      status: "warn",
      reason: "3/10 failed; most common reason: model_error",
    });
  });
  it("removes the configured API key from a failing model test", () => {
    expect(
      safeHealthError(new Error("Invalid bearer secret-key: api_key=secret-key"), ["secret-key"])
    ).not.toContain("secret-key");
  });
});
