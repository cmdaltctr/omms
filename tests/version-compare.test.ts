import { describe, expect, it } from "bun:test";
import { compareVersions, isOlderVersion } from "../src/services/version-compare.js";

describe("compareVersions", () => {
  it("orders releases numerically", () => {
    expect(compareVersions("3.5.0", "3.6.0")).toBeLessThan(0);
    expect(compareVersions("3.10.0", "3.9.0")).toBeGreaterThan(0);
    expect(compareVersions("3.5.0", "3.5.0")).toBe(0);
  });

  it("orders a prerelease before its release", () => {
    expect(compareVersions("3.5.0-next.33", "3.5.0")).toBeLessThan(0);
    expect(compareVersions("3.5.0", "3.5.0-next.33")).toBeGreaterThan(0);
  });

  it("compares numeric prerelease parts as numbers", () => {
    expect(compareVersions("3.5.0-next.9", "3.5.0-next.10")).toBeLessThan(0);
    expect(compareVersions("3.5.0-alpha.1", "3.5.0-beta.1")).toBeLessThan(0);
    expect(compareVersions("3.5.0-next", "3.5.0-next.1")).toBeLessThan(0);
  });

  it("returns null when either version cannot be placed", () => {
    expect(compareVersions("unknown", "3.5.0")).toBeNull();
    expect(compareVersions("3.5.0", "garbage")).toBeNull();
    expect(compareVersions("3.5", "3.5.0")).toBeNull();
  });
});

describe("isOlderVersion", () => {
  it("is true only when the first version is provably older", () => {
    expect(isOlderVersion("3.5.0-next.33", "3.5.0")).toBe(true);
    expect(isOlderVersion("3.5.0", "3.5.0")).toBe(false);
    expect(isOlderVersion("3.6.0", "3.5.0")).toBe(false);
    expect(isOlderVersion("unknown", "3.5.0")).toBe(false);
    expect(isOlderVersion("3.5.0", "garbage")).toBe(false);
  });
});
