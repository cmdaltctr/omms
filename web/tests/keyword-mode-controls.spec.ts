import { expect, it } from "bun:test";
import {
  KEYWORD_MODE_MESSAGES,
  KEYWORD_MODE_OPTIONS,
  keywordModeSaveEdits,
  modeFromSetting,
  rerankerOverridesMode,
} from "../src/lib/keyword-mode-controls.ts";

it("offers the boost first and marks rank fusion as experimental", () => {
  expect(KEYWORD_MODE_OPTIONS.map((option) => option.value)).toEqual(["boost", "rrf"]);
  expect(KEYWORD_MODE_OPTIONS[1].label).toContain("(experimental)");
  for (const option of KEYWORD_MODE_OPTIONS) expect(KEYWORD_MODE_MESSAGES).toContain(option.label);
});

it("reads a mode and falls back to boost for anything else", () => {
  expect(modeFromSetting("rrf")).toBe("rrf");
  expect(modeFromSetting("boost")).toBe("boost");
  for (const bad of [undefined, null, "fusion", 1]) expect(modeFromSetting(bad)).toBe("boost");
});

it("saves the chosen mode only", () => {
  expect(keywordModeSaveEdits("rrf")).toEqual({ keywordMode: "rrf" });
});

it("says the reranker overrides the mode only when it is switched on with a URL and model", () => {
  const on = {
    rerankerEnabled: { value: true },
    rerankerApiUrl: { value: "http://127.0.0.1:3008/v1" },
    rerankerModel: { value: "m" },
  };
  expect(rerankerOverridesMode(on)).toBe(true);
  expect(rerankerOverridesMode({ ...on, rerankerEnabled: { value: false } })).toBe(false);
  expect(rerankerOverridesMode({ ...on, rerankerModel: { value: " " } })).toBe(false);
  expect(rerankerOverridesMode({ ...on, rerankerApiUrl: {} })).toBe(false);
  expect(rerankerOverridesMode({})).toBe(false);
});
