import { describe, expect, it } from "bun:test";
import {
  historyKindKey,
  isSourceDeleted,
  legendLetters,
  modifiedText,
  searchRows,
} from "../web/src/lib/chat-skills.ts";

// A stand-in for the translation helper: key plus its params, so the test sees both.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe("legendLetters", () => {
  it("shows S and P only, with skill facts off and no K source", () => {
    expect(legendLetters(false, false)).toEqual(["S", "P"]);
  });
  it("shows K when skill facts are on", () => {
    expect(legendLetters(true, false)).toEqual(["S", "P", "K"]);
  });
  it("shows K when the open chat holds a K source, even with skill facts off", () => {
    expect(legendLetters(false, true)).toEqual(["S", "P", "K"]);
  });
  it("shows K when both hold", () => {
    expect(legendLetters(true, true)).toEqual(["S", "P", "K"]);
  });
});

describe("isSourceDeleted", () => {
  const memory = { kind: "memory", id: "m1" } as never;
  const skill = { kind: "skill", id: "alpha" } as never;
  const profile = { kind: "profile", id: "p1" } as never;
  it("strikes through a memory that no longer exists", () => {
    expect(isSourceDeleted(memory, new Set(["m1"]), new Set())).toBe(true);
    expect(isSourceDeleted(memory, new Set(), new Set(["m1"]))).toBe(false);
  });
  it("strikes through a skill that is no longer listed", () => {
    expect(isSourceDeleted(skill, new Set(), new Set(["alpha"]))).toBe(true);
    expect(isSourceDeleted(skill, new Set(["alpha"]), new Set())).toBe(false);
  });
  it("never strikes through a profile item or a missing source", () => {
    expect(isSourceDeleted(profile, new Set(["p1"]), new Set(["p1"]))).toBe(false);
    expect(isSourceDeleted(undefined, new Set(), new Set())).toBe(false);
  });
});

describe("modifiedText", () => {
  it("says Yes with the date, or No", () => {
    const fmt = () => "5 Oct";
    expect(modifiedText({ modified: true, lastAppliedAt: 1 }, t, fmt)).toBe(
      'chat-skill-modified-yes:{"date":"5 Oct"}'
    );
    expect(modifiedText({ modified: false, lastAppliedAt: null }, t, fmt)).toBe(
      "chat-skill-modified-no"
    );
  });
});

describe("historyKindKey", () => {
  it("maps each history kind to a translation key", () => {
    expect(historyKindKey("applied")).toBe("chat-skill-kind-applied");
    expect(historyKindKey("stale")).toBe("chat-skill-kind-stale");
  });
});

describe("searchRows", () => {
  const base = { queries: ["q"], tags: ["bun"], profileCategories: [], skipped: false };

  it("shows an old saved plan as today", () => {
    expect(searchRows(base, t)).toEqual([
      ["chat-search-phrases", ["q"]],
      ["chat-search-tags", ["bun"]],
      ["chat-search-categories", []],
    ]);
  });

  it("adds the skills and the skill question type when the plan has them", () => {
    const rows = searchRows({ ...base, skills: ["alpha"], skillIntent: "needs-work" }, t);
    expect(rows.slice(3)).toEqual([
      ["chat-search-skills", ["alpha"]],
      ["chat-search-skill-intent", ["chat-intent-needs-work"]],
    ]);
  });

  it("shows no skill question type for intent none", () => {
    const rows = searchRows({ ...base, skills: [], skillIntent: "none" }, t);
    expect(rows.slice(3)).toEqual([
      ["chat-search-skills", []],
      ["chat-search-skill-intent", ["chat-intent-none"]],
    ]);
  });
});
