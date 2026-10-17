import { describe, expect, it } from "bun:test";
import { shouldStartAutoCleanup } from "../src/services/user-profile/auto-cleanup-trigger.js";

const on = { enabled: true, interval: 100 };

describe("shouldStartAutoCleanup", () => {
  it("starts only when a prompt interval is crossed", () => {
    expect(shouldStartAutoCleanup(90, 10, on)).toBe(true);
    expect(shouldStartAutoCleanup(100, 10, on)).toBe(false);
  });

  it("starts when the count passes a multiple in the middle of a pass", () => {
    expect(shouldStartAutoCleanup(95, 10, on)).toBe(true);
    expect(shouldStartAutoCleanup(0, 100, on)).toBe(true);
    expect(shouldStartAutoCleanup(101, 98, on)).toBe(false);
  });

  it("does not start when the setting is off", () => {
    expect(shouldStartAutoCleanup(90, 10, { enabled: false, interval: 100 })).toBe(false);
  });

  it("does not start for an interval that is not a positive whole number", () => {
    expect(shouldStartAutoCleanup(90, 10, { enabled: true, interval: 0 })).toBe(false);
    expect(shouldStartAutoCleanup(90, 10, { enabled: true, interval: -100 })).toBe(false);
    expect(shouldStartAutoCleanup(90, 10, { enabled: true, interval: 1.5 })).toBe(false);
    expect(shouldStartAutoCleanup(90, 10, { enabled: true, interval: undefined })).toBe(false);
  });

  it("treats an unset enabled flag as off", () => {
    expect(shouldStartAutoCleanup(90, 10, { interval: 100 })).toBe(false);
  });

  it("does not start when nothing was added", () => {
    expect(shouldStartAutoCleanup(100, 0, on)).toBe(false);
  });

  it("starts once for a jump over several multiples, as one pass saves once", () => {
    expect(shouldStartAutoCleanup(90, 300, on)).toBe(true);
  });
});
