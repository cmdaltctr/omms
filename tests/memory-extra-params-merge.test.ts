import { describe, expect, it } from "bun:test";
import {
  keepGlobalExtraParams,
  keepGlobalReasoning,
} from "../src/services/memory-extra-params-merge.js";

type Params = { memoryExtraParams?: unknown };

describe("keepGlobalReasoning", () => {
  it("keeps the global reasoning field when the project sets other members only", () => {
    const project: Params = { memoryExtraParams: { top_p: 0.9 } };
    keepGlobalReasoning({ memoryExtraParams: { reasoning: { effort: "low" } } }, project);
    expect(project.memoryExtraParams).toEqual({ top_p: 0.9, reasoning: { effort: "low" } });
  });

  it("keeps each of the three global reasoning members", () => {
    for (const global of [
      { reasoning: { effort: "low" } },
      { reasoning_effort: "high" },
      { thinking: { type: "disabled" } },
    ]) {
      const project: Params = { memoryExtraParams: { top_p: 0.9 } };
      keepGlobalReasoning({ memoryExtraParams: global }, project);
      expect(project.memoryExtraParams).toEqual({ top_p: 0.9, ...global });
    }
  });

  it("lets a project reasoning field win and copies no global one", () => {
    const project: Params = { memoryExtraParams: { thinking: { type: "disabled" } } };
    keepGlobalReasoning({ memoryExtraParams: { reasoning: { effort: "low" } } }, project);
    expect(project.memoryExtraParams).toEqual({ thinking: { type: "disabled" } });
  });

  it("leaves a project without memoryExtraParams alone", () => {
    const project: Params = {};
    keepGlobalReasoning({ memoryExtraParams: { reasoning: { effort: "low" } } }, project);
    expect("memoryExtraParams" in project).toBe(false);
  });

  it("does nothing when the global config has no reasoning field", () => {
    const project: Params = { memoryExtraParams: { top_p: 0.9 } };
    keepGlobalReasoning({ memoryExtraParams: { provider: { zdr: true } } }, project);
    expect(project.memoryExtraParams).toEqual({ top_p: 0.9 });
  });
});

describe("keepGlobalExtraParams", () => {
  it("keeps the global provider and the global reasoning field together", () => {
    const provider = { zdr: true };
    const project: Params = { memoryExtraParams: { top_p: 0.9 } };
    keepGlobalExtraParams(
      { memoryExtraParams: { provider, reasoning: { effort: "low" } } },
      project
    );
    expect(project.memoryExtraParams).toEqual({
      top_p: 0.9,
      provider,
      reasoning: { effort: "low" },
    });
  });
});
