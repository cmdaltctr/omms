import { describe, expect, it } from "bun:test";
import {
  ANSWER_TOOL,
  buildAnswerPrompt,
  finaliseAnswer,
  numberSources,
  validateCitations,
} from "../src/services/chat/chat-answer.js";

const memory = (id: string) => ({ label: "", kind: "memory" as const, id, text: `text ${id}` });
const profile = (id: string) => ({ label: "", kind: "profile" as const, id, text: `pref ${id}` });

describe("numberSources", () => {
  it("labels memories S1… and profile items P1…", () => {
    const sources = numberSources({
      memories: [memory("a"), memory("b")],
      profile: [profile("x")],
    });
    expect(sources.map((s) => s.label)).toEqual(["S1", "S2", "P1"]);
  });
});

describe("buildAnswerPrompt", () => {
  it("lists each source with its label and asks for citations", () => {
    const sources = numberSources({ memories: [memory("a")], profile: [profile("x")] });
    const { system, user } = buildAnswerPrompt("why?", [], sources);
    expect(user).toContain("[S1] text a");
    expect(user).toContain("[P1] pref x");
    expect(user).toContain("Question: why?");
    expect(system).toContain("only");
    expect(ANSWER_TOOL.function.name).toBe("answer");
  });
});

describe("validateCitations", () => {
  it("removes labels that were not sent and keeps first-use order", () => {
    const out = validateCitations("Use npm [S2]. Also [S9] and [P1][S2] and [S1].", [
      "S1",
      "S2",
      "P1",
    ]);
    expect(out.text).toBe("Use npm [S2]. Also and [P1][S2] and [S1].");
    expect(out.cited).toEqual(["S2", "P1", "S1"]);
  });

  it("removes every marker when nothing matches", () => {
    expect(validateCitations("Claim [S3] [P4]", ["S1"])).toEqual({ text: "Claim", cited: [] });
  });

  it("leaves other bracketed text alone", () => {
    expect(validateCitations("Array [1] and [x] [S1]", ["S1"]).text).toBe("Array [1] and [x] [S1]");
  });
});

describe("finaliseAnswer", () => {
  const sources = numberSources({ memories: [memory("a")], profile: [] });

  it("passes insufficient through", () => {
    const out = finaliseAnswer({ answer: "Not in sources.", insufficient: true }, sources);
    expect(out.insufficient).toBe(true);
    expect(out.uncited).toBe(false);
  });

  it("flags an answer with no valid citation", () => {
    const out = finaliseAnswer({ answer: "Claim [S5].", insufficient: false }, sources);
    expect(out).toEqual({ text: "Claim.", cited: [], insufficient: false, uncited: true });
  });

  it("returns null for a reply with no answer text", () => {
    expect(finaliseAnswer({}, sources)).toBeNull();
    expect(finaliseAnswer(null, sources)).toBeNull();
  });
});
