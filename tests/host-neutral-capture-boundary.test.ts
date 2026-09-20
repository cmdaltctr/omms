import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const hostNeutralFiles = [
  "src/core/host.ts",
  "src/core/capture-context.ts",
  "src/core/capture.ts",
  "src/services/auto-capture.ts",
];

describe("host-neutral capture boundary", () => {
  it("does not import OpenCode or Pi SDKs into the shared capture path", () => {
    for (const file of hostNeutralFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("@opencode");
      expect(source).not.toContain("@mariozechner/pi");
      expect(source).not.toContain("/adapters/opencode");
      expect(source).not.toContain("/adapters/pi");
    }
  });
});
