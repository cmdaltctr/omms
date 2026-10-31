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

const skill = (id: string) => ({
  label: "",
  kind: "skill" as const,
  id,
  text: `${id}: 4 uses, 1 failed turn\nModified: no`,
});

describe("skill sources", () => {
  const sources = numberSources({
    memories: [memory("a")],
    profile: [profile("x")],
    skills: [skill("alpha"), skill("beta")],
  });

  it("numbers skill sources K1, K2 after S and P", () => {
    expect(sources.map((s) => s.label)).toEqual(["S1", "P1", "K1", "K2"]);
  });

  it("sends the skill text and names K sources in the system text", () => {
    const { system, user } = buildAnswerPrompt("which need work?", [], sources);
    expect(user).toContain("[K1] alpha: 4 uses, 1 failed turn\nModified: no");
    expect(user).toContain("[K2] beta: 4 uses");
    expect(system).toContain("[K1]");
  });

  it("leaves the system text as today when no skill source is sent", () => {
    const plain = numberSources({ memories: [memory("a")], profile: [profile("x")] });
    const { system } = buildAnswerPrompt("why?", [], plain);
    expect(system).not.toContain("K1");
    expect(system.toLowerCase()).not.toContain("skill");
  });

  it("removes a K marker that was not sent", () => {
    const out = validateCitations("Alpha fails [K1] and beta [K4].", ["S1", "K1", "K2"]);
    expect(out.text).toBe("Alpha fails [K1] and beta.");
    expect(out.cited).toEqual(["K1"]);
  });

  it("removes every K marker when no K source was sent", () => {
    const out = validateCitations("Claim [K1] and [S1].", ["S1"]);
    expect(out.text).toBe("Claim and [S1].");
    expect(out.cited).toEqual(["S1"]);
  });
});

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
