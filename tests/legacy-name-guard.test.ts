import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const LEGACY_NAME = /opencode-mem|OpenCodeMem|OPENCODE_MEM/;

/**
 * Files that implement a documented legacy fallback (openspec change
 * opencode-v2-native, design D7). Every other source file must use omms names.
 */
const LEGACY_FALLBACK_FILES = new Set([
  "src/config.ts", // legacy global and project config paths, legacy storage layout
  "src/services/legacy-migration.ts", // ~/.opencode-mem -> ~/.omms store migration
  "src/services/logger.ts", // OPENCODE_MEM_LOG_FILE override
  "src/services/tags.ts", // .opencode-mem-project marker
  "src/services/auth-token.ts", // legacy token file and x-opencode-mem-token header
  "src/services/ai/internal-capture-sessions.ts", // legacy capture session title
  "src/services/onnxruntime-resolve.ts", // pre-migration plugin cache path hint
  "web/src/lib/preferences.ts", // legacy localStorage adoption
  "web/src/lib/theme.ts", // opencode-mem-theme key
  "web/src/lib/i18n/index.ts", // opencode-mem-lang key
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css|html)$/.test(entry.name) ? [path] : [];
  });
}

export function findLeftoverNames(files: string[]): string[] {
  return files.flatMap((file) => {
    const rel = relative(root, file).split("\\").join("/");
    if (LEGACY_FALLBACK_FILES.has(rel)) return [];
    return readFileSync(file, "utf-8")
      .split("\n")
      .flatMap((line, index) =>
        LEGACY_NAME.test(line) ? [`${rel}:${index + 1}: ${line.trim()}`] : []
      );
  });
}

describe("legacy name guard", () => {
  it("keeps opencode-mem names out of source outside the legacy fallbacks", () => {
    const files = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "web/src"))];
    expect(findLeftoverNames(files)).toEqual([]);
  });

  it("allowlists only files that exist and still carry a legacy fallback", () => {
    for (const rel of LEGACY_FALLBACK_FILES) {
      expect(LEGACY_NAME.test(readFileSync(join(root, rel), "utf-8"))).toBe(true);
    }
  });
});
