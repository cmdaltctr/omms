import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const hostNeutralFiles = [
  "src/core/host.ts",
  "src/core/capture-context.ts",
  "src/core/capture.ts",
  "src/core/turn-outputs.ts",
  "src/services/auto-capture.ts",
];

/** Every module specifier a file imports, statically or with `import()`. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)].map(
    (match) => match[1]!
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .map((path) => join(dir, path).replaceAll("\\", "/"));
}

const SKILL_FOLDER = "src/services/skill-learning";

// Profile learning and memory retrieval must not read the skill store (ADR-036).
const profileAndRetrievalFiles = sourceFiles("src").filter(
  (path) =>
    !path.startsWith(SKILL_FOLDER) &&
    (/profile|retrieval|memory-operations|memory-tool/.test(basename(path)) ||
      path.startsWith("src/services/user-profile/") ||
      path.startsWith("src/services/user-prompt/") ||
      path === "src/services/client.ts")
);

describe("host-neutral capture boundary", () => {
  it("does not import OpenCode or Pi SDKs into the shared capture path", () => {
    for (const file of hostNeutralFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("@opencode");
      expect(source).not.toContain("@earendil-works");
      expect(source).not.toContain("/adapters/opencode");
      expect(source).not.toContain("/adapters/pi");
    }
  });

  it("keeps the shared turn path free of skill-learning imports", () => {
    const leaking = importsOf("src/core/turn-outputs.ts").filter((spec) =>
      spec.includes("skill-learning")
    );
    expect(leaking).toEqual([]);
  });

  it("keeps host SDKs and adapters out of skill learning", () => {
    const files = sourceFiles(SKILL_FOLDER);
    expect(files.length).toBeGreaterThan(0);
    const leaking = files.flatMap((file) =>
      importsOf(file)
        .filter((spec) => /^@opencode-ai\/|^@earendil-works\/|\/adapters\//.test(spec))
        .map((spec) => `${file}: ${spec}`)
    );
    expect(leaking).toEqual([]);
  });

  it("keeps profile learning and memory retrieval away from skills.db", () => {
    // Guards the scan: an empty list would pass the check below.
    expect(profileAndRetrievalFiles.length).toBeGreaterThan(20);
    const leaking = profileAndRetrievalFiles.filter(
      (file) =>
        importsOf(file).some((spec) => spec.includes("skill-learning")) ||
        /skills\.db|SKILLS_DB_FILE|SkillStore/.test(readFileSync(file, "utf8"))
    );
    expect(leaking).toEqual([]);
  });
});
