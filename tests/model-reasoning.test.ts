import { describe, expect, it } from "bun:test";
import {
  ignoredReasoningField,
  reasoningChoices,
  reasoningFamily,
  reasoningFields,
  savedLevel,
} from "../src/shared/model-reasoning.js";

const OPENROUTER = "https://openrouter.ai/api/v1";

describe("reasoningFamily", () => {
  it("picks the family from the host, then the provider", () => {
    expect(reasoningFamily(OPENROUTER, "openai-chat")).toBe("openrouter");
    expect(reasoningFamily(OPENROUTER, "openai-responses")).toBe("openrouter");
    expect(reasoningFamily("https://api.deepseek.com", "openai-chat")).toBe("deepseek");
    expect(reasoningFamily("https://api.openai.com/v1", "openai-responses")).toBe("responses");
    expect(reasoningFamily("https://api.example.com/v1", "openai-chat")).toBe("chat");
    expect(reasoningFamily("https://api.example.com/v1", undefined)).toBe("chat");
  });

  it("has no control for the four providers that keep their field in the file", () => {
    for (const provider of ["anthropic", "minimax", "google-gemini", "orcarouter"]) {
      expect(reasoningFamily(OPENROUTER, provider)).toBe("none");
    }
  });

  it("does not match a look-alike host", () => {
    expect(reasoningFamily("https://openrouter.ai.evil.test/v1", "openai-chat")).toBe("chat");
    expect(reasoningFamily("not a url", "openai-chat")).toBe("chat");
  });
});

describe("reasoningChoices", () => {
  it("offers the four levels of deepseek/deepseek-v4.1-flash-1017 and names its default", () => {
    const choices = reasoningChoices("openrouter", {
      supported_efforts: ["max", "high", "low", "none"],
      default_effort: "high",
      mandatory: false,
    });
    expect(choices.levels).toEqual(["default", "off", "low", "high", "max"]);
    expect(choices.defaultEffort).toBe("high");
    expect(choices.note).toBeUndefined();
  });

  it("hides Off when reasoning is mandatory", () => {
    const choices = reasoningChoices("openrouter", {
      supported_efforts: ["high", "medium", "low"],
      mandatory: true,
    });
    expect(choices.levels).toEqual(["default", "low", "medium", "high"]);
    const withNone = reasoningChoices("openrouter", {
      supported_efforts: ["none", "low"],
      mandatory: true,
    });
    expect(withNone.levels).toEqual(["default", "low"]);
  });

  it("offers on and off for a model that has reasoning but no effort list", () => {
    expect(reasoningChoices("openrouter", { mandatory: false }).levels).toEqual([
      "default",
      "off",
      "on",
    ]);
    expect(reasoningChoices("openrouter", { mandatory: true }).levels).toEqual(["default", "on"]);
  });

  it("gives the general choices and the nearest-level note when there are no facts", () => {
    for (const facts of [undefined, {}]) {
      const choices = reasoningChoices("openrouter", facts);
      expect(choices.levels).toEqual(["default", "off", "low", "medium", "high"]);
      expect(choices.note).toBe("nearest");
    }
  });

  it("offers the fixed choices of the other families", () => {
    expect(reasoningChoices("deepseek").levels).toEqual(["default", "off", "on"]);
    expect(reasoningChoices("responses").levels).toEqual(["default", "low", "medium", "high"]);
    const chat = reasoningChoices("chat");
    expect(chat.levels).toEqual(["default", "low", "medium", "high"]);
    expect(chat.note).toBe("may-ignore");
    expect(reasoningChoices("none").levels).toEqual([]);
  });
});

describe("reasoningFields", () => {
  it("writes the field of each family", () => {
    expect(reasoningFields("openrouter", "low")).toEqual({ reasoning: { effort: "low" } });
    expect(reasoningFields("openrouter", "off")).toEqual({ reasoning: { effort: "none" } });
    expect(reasoningFields("openrouter", "off", true)).toEqual({ reasoning: { enabled: false } });
    expect(reasoningFields("openrouter", "on", true)).toEqual({ reasoning: { enabled: true } });
    expect(reasoningFields("deepseek", "off")).toEqual({ thinking: { type: "disabled" } });
    expect(reasoningFields("deepseek", "on")).toEqual({ thinking: { type: "enabled" } });
    expect(reasoningFields("responses", "medium")).toEqual({ reasoning: { effort: "medium" } });
    expect(reasoningFields("chat", "high")).toEqual({ reasoning_effort: "high" });
  });

  it("writes nothing for Default in every family", () => {
    for (const family of ["openrouter", "deepseek", "responses", "chat", "none"] as const) {
      expect(reasoningFields(family, "default")).toEqual({});
    }
  });

  it("returns undefined for a level the family does not accept", () => {
    expect(reasoningFields("chat", "on")).toBeUndefined();
    expect(reasoningFields("chat", "off")).toBeUndefined();
    expect(reasoningFields("none", "low")).toBeUndefined();
    expect(reasoningFields("deepseek", "low")).toBeUndefined();
    expect(reasoningFields("responses", "max")).toBeUndefined();
    expect(reasoningFields("openrouter", "on")).toBeUndefined();
  });
});

describe("savedLevel", () => {
  it("reads the level back for each family", () => {
    expect(savedLevel("openrouter", undefined)).toBe("default");
    expect(savedLevel("openrouter", { reasoning: { effort: "high" } })).toBe("high");
    expect(savedLevel("openrouter", { reasoning: { effort: "none" } })).toBe("off");
    expect(savedLevel("openrouter", { reasoning: { enabled: false } })).toBe("off");
    expect(savedLevel("openrouter", { reasoning: { enabled: true } })).toBe("on");
    expect(savedLevel("deepseek", { thinking: { type: "disabled" } })).toBe("off");
    expect(savedLevel("deepseek", { thinking: { type: "enabled" } })).toBe("on");
    expect(savedLevel("responses", { reasoning: { effort: "low" } })).toBe("low");
    expect(savedLevel("chat", { reasoning_effort: "medium" })).toBe("medium");
    expect(savedLevel("chat", { provider: { zdr: true } })).toBe("default");
  });

  it("says custom for a value it cannot show as a level", () => {
    expect(savedLevel("openrouter", { reasoning: { max_tokens: 2000 } })).toBe("custom");
    expect(savedLevel("openrouter", { reasoning: { effort: "high", exclude: true } })).toBe(
      "custom"
    );
    expect(savedLevel("openrouter", { reasoning: "high" })).toBe("custom");
    expect(savedLevel("deepseek", { thinking: { type: "adaptive" } })).toBe("custom");
    expect(savedLevel("chat", { reasoning_effort: "turbo" })).toBe("custom");
  });
});

describe("ignoredReasoningField", () => {
  it("names a field the endpoint ignores", () => {
    expect(ignoredReasoningField("openrouter", { thinking: { type: "disabled" } })).toBe(
      "thinking"
    );
    expect(ignoredReasoningField("deepseek", { reasoning: { effort: "low" } })).toBe("reasoning");
  });

  it("names nothing when the field fits", () => {
    expect(ignoredReasoningField("openrouter", { reasoning: { effort: "low" } })).toBeUndefined();
    expect(ignoredReasoningField("deepseek", { thinking: { type: "enabled" } })).toBeUndefined();
    expect(ignoredReasoningField("chat", { thinking: { type: "enabled" } })).toBeUndefined();
    expect(ignoredReasoningField("openrouter", undefined)).toBeUndefined();
  });
});

describe("savedLevel with a value of the wrong type", () => {
  it("says custom instead of throwing", () => {
    expect(savedLevel("deepseek", { thinking: null })).toBe("custom");
    expect(savedLevel("deepseek", { thinking: "off" })).toBe("custom");
    expect(savedLevel("openrouter", { reasoning: null })).toBe("custom");
  });
});
