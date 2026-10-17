import { describe, expect, it } from "bun:test";
import {
  AUTO_CLEANUP_INTERVAL_MAX,
  AUTO_CLEANUP_INTERVAL_MIN,
  enabledEdit,
  intervalEdit,
  parseInterval,
} from "../web/src/lib/components/memory/auto-cleanup-settings-state.js";

describe("parseInterval", () => {
  it("accepts a whole number from 50 to 100000", () => {
    expect(parseInterval("50")).toEqual({ ok: true, value: 50 });
    expect(parseInterval("500")).toEqual({ ok: true, value: 500 });
    expect(parseInterval("100000")).toEqual({ ok: true, value: 100000 });
    expect(parseInterval("  300 ")).toEqual({ ok: true, value: 300 });
  });

  it("refuses a number outside the range", () => {
    for (const text of ["49", "10", "0", "100001", "-500"]) {
      expect(parseInterval(text).ok).toBe(false);
    }
  });

  it("refuses a value that is not a whole number", () => {
    for (const text of ["2.5", "500.0", "1e3", "five hundred", "", "  ", "0x1F4", "500abc"]) {
      expect(parseInterval(text).ok).toBe(false);
    }
  });

  it("gives one message that names the range", () => {
    const refused = parseInterval("10");
    expect(refused).toEqual({ ok: false, message: "Enter a whole number from 50 to 100000." });
  });

  it("exports the limits the server uses", () => {
    expect(AUTO_CLEANUP_INTERVAL_MIN).toBe(50);
    expect(AUTO_CLEANUP_INTERVAL_MAX).toBe(100000);
  });
});

describe("intervalEdit", () => {
  it("sends the interval when it differs from the saved value", () => {
    expect(intervalEdit(500, "300")).toEqual({
      kind: "edit",
      edits: { userProfileAutoCleanupInterval: 300 },
    });
  });

  it("sends nothing when the value is unchanged", () => {
    expect(intervalEdit(500, "500")).toEqual({ kind: "none" });
    expect(intervalEdit(500, " 500 ")).toEqual({ kind: "none" });
  });

  it("reports an error and sends nothing for a refused value", () => {
    expect(intervalEdit(500, "10")).toEqual({
      kind: "error",
      message: "Enter a whole number from 50 to 100000.",
    });
  });
});

describe("enabledEdit", () => {
  it("sends the switch when it differs from the saved value", () => {
    expect(enabledEdit(true, false)).toEqual({ userProfileAutoCleanupEnabled: false });
    expect(enabledEdit(false, true)).toEqual({ userProfileAutoCleanupEnabled: true });
  });

  it("sends nothing when the switch is unchanged", () => {
    expect(enabledEdit(true, true)).toBeNull();
  });
});
