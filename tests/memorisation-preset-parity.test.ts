import { expect, it } from "bun:test";
import { presetSizeIn as corePresetSizeIn } from "../src/core/memorisation.js";
import { presetSizeIn as webPresetSizeIn } from "../web/src/lib/memorisation-model.ts";

// The web app keeps its own copy of the token rule, because web/ imports nothing from src/.
it("converts a preset to the same number in the web app and in the core", () => {
  for (const unit of ["characters", "tokens"] as const) {
    for (let chars = 100; chars <= 20000; chars += 1) {
      expect(webPresetSizeIn(chars, unit)).toBe(corePresetSizeIn(chars, unit));
    }
  }
});
