import { describe, expect, it } from "bun:test";
import { healthBody } from "../src/services/health-body.js";

const API = {
  memoryModel: "gpt-test",
  memoryApiUrl: "https://api.example.test/v1",
  memoryApiKey: "sk-real-looking-key",
};

describe("healthBody", () => {
  it("keeps success, status, authEnabled and instance", () => {
    const body = healthBody({
      authEnabled: true,
      instance: "abc",
      config: { autoCaptureEnabled: true, ...API },
    });
    expect(body).toMatchObject({ success: true, status: "ok", authEnabled: true, instance: "abc" });
  });

  it("adds the Claude Code capture state", () => {
    const base = { authEnabled: false, instance: "abc" };
    expect(
      healthBody({ ...base, config: { autoCaptureEnabled: true, ...API } }).claudeCapture
    ).toBe("ready");
    expect(healthBody({ ...base, config: { autoCaptureEnabled: true } }).claudeCapture).toBe(
      "needs-setup"
    );
    expect(healthBody({ ...base, config: { autoCaptureEnabled: false } }).claudeCapture).toBe(
      "off"
    );
  });

  it("carries no secret", () => {
    const body = healthBody({
      authEnabled: false,
      instance: "abc",
      config: { autoCaptureEnabled: true, ...API },
    });
    expect(JSON.stringify(body)).not.toContain(API.memoryApiKey);
    expect(Object.keys(body).sort()).toEqual(
      ["authEnabled", "claudeCapture", "instance", "status", "success"].sort()
    );
  });
});
