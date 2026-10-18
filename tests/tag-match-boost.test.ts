import { describe, expect, it } from "bun:test";
import { tagMatchBoost } from "../src/services/turso/tag-match.js";

describe("tagMatchBoost", () => {
  it("does not match a short tag inside a longer word", () => {
    expect(tagMatchBoost("build the guide", "ui")).toBe(0);
    expect(tagMatchBoost("refactoring notes", "act")).toBe(0);
  });

  it("does not match a long query word inside a tag", () => {
    expect(tagMatchBoost("pro tips", "profile-learning")).toBe(0);
  });

  it("matches a whole tag", () => {
    expect(tagMatchBoost("fix the ui", "ui, web")).toBeCloseTo(1 / 3);
  });

  it("matches one part of a hyphenated tag", () => {
    expect(tagMatchBoost("claude hooks", "claude-code")).toBe(0.5);
  });

  it("ignores case and punctuation around words", () => {
    expect(tagMatchBoost("UI?", "ui")).toBe(1);
  });

  it("finds a tag inside a query written without spaces", () => {
    expect(tagMatchBoost("修复用户界面的问题", "用户界面")).toBe(1);
  });

  it("matches a one-character query word only to a whole tag", () => {
    expect(tagMatchBoost("C language", "c")).toBe(0.5);
    expect(tagMatchBoost("a build", "c")).toBe(0);
  });

  it("finds a part of a hyphenated tag inside a query without spaces", () => {
    expect(tagMatchBoost("请修复界面的问题", "用户-界面")).toBe(1);
  });

  it("returns 0 without words or tags", () => {
    expect(tagMatchBoost(undefined, "ui")).toBe(0);
    expect(tagMatchBoost("ui", "")).toBe(0);
  });
});
