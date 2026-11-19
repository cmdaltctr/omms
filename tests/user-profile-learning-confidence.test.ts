import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  createUserProfileAnalysisSchema,
  USER_PROFILE_LLM_CONFIDENCE_MAX,
} from "../src/core/extraction.js";
import { analyzeProfile } from "../src/core/profile-analysis.js";
import { UserProfileValidator } from "../src/services/ai/validators/user-profile-validator.js";

describe("user-profile-learning confidence schema (#231)", () => {
  const schema = createUserProfileAnalysisSchema(z);

  const baseProfile = {
    preferences: [
      {
        category: "style",
        description: "Prefers concise answers",
        confidence: 0.8,
        evidence: ["please keep it short"],
      },
    ],
    patterns: [],
    workflows: [],
  };

  it("accepts confidence values above 0.5 (Groq Llama native 0–1 scale)", () => {
    const parsed = schema.parse(baseProfile);
    expect(parsed.preferences[0]?.confidence).toBe(0.8);
  });

  it("accepts confidence at the upper bound of 1", () => {
    const parsed = schema.parse({
      ...baseProfile,
      preferences: [{ ...baseProfile.preferences[0], confidence: 1 }],
    });
    expect(parsed.preferences[0]?.confidence).toBe(1);
  });

  it("rejects confidence above 1", () => {
    expect(() =>
      schema.parse({
        ...baseProfile,
        preferences: [{ ...baseProfile.preferences[0], confidence: 1.1 }],
      })
    ).toThrow();
  });

  // Every host checks the reply against the shared schema (change unify-profile-learning);
  // the OpenCode tool schema that held its own maximum is gone.
  it("bounds confidence at the shared maximum for every host's reply check", async () => {
    expect(USER_PROFILE_LLM_CONFIDENCE_MAX).toBe(1);
    const reply = (confidence: number) => ({
      ...baseProfile,
      preferences: [{ ...baseProfile.preferences[0], confidence }],
    });
    expect(schema.safeParse(reply(USER_PROFILE_LLM_CONFIDENCE_MAX)).success).toBe(true);
    expect(schema.safeParse(reply(-0.1)).success).toBe(false);
    const model = {
      provider: "stub",
      modelId: "stub",
      complete: async () => JSON.stringify(reply(USER_PROFILE_LLM_CONFIDENCE_MAX + 0.1)),
    };
    await expect(analyzeProfile(model, "1. Keep it short", null)).rejects.toThrow(
      "invalid profile payload"
    );
  });

  it("rejects out-of-range confidence during provider response validation", () => {
    expect(
      UserProfileValidator.validate({
        ...baseProfile,
        preferences: [{ ...baseProfile.preferences[0], confidence: 1.1 }],
      }).valid
    ).toBe(false);
    expect(UserProfileValidator.validate(baseProfile).valid).toBe(true);
  });
});
