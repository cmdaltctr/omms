import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const CEILING = 500;

// Translation tables are data, so splitting them adds nothing.
const exemptPrefixes = ["web/src/lib/i18n/"];

// Files already over the ceiling, with their line count when the rule began.
// A file here may shrink but not grow. Delete its entry when it reaches the
// ceiling or is removed; the stale-entry check below fails until you do.
const overCeilingBaseline: Record<string, number> = {
  "src/services/user-profile/user-profile-manager.ts": 1931,
  "src/services/web-server.ts": 1823,
  "src/services/api-handlers.ts": 1347,
  "src/config.ts": 927,
  "src/adapters/opencode/profile-learning.ts": 808,
  "src/index.ts": 784,
  "src/services/turso/legacy-migrator.ts": 657,
  "src/adapters/opencode/opencode-provider.ts": 641,
  "src/services/turso/shard-manager.ts": 616,
  "src/importer/importer.ts": 616,
  "src/importer/claude-hook-api.ts": 540,
  "web/src/lib/components/explorer/AppSidebar.tsx": 571,
  "src/services/tag-prefix-migration.ts": 567,
  "web/src/lib/components/explorer/AiCleanupDialog.tsx": 523,
  "src/services/ai/providers/openai-chat-completion.ts": 536,
  "src/services/turso/vector-search.ts": 533,
  "src/services/shard-path-migration-service.ts": 508,
  "web/src/hooks/useMemoriesExplorer.ts": 504,
};

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(join(repoRoot, dir), { recursive: true }) as string[];
  return entries
    .map((entry) => `${dir}/${entry.split("\\").join("/")}`)
    .filter((path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts"));
}

function lineCount(path: string): number {
  const text = readFileSync(join(repoRoot, path), "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

const lineCounts = new Map<string, number>();
for (const path of [...sourceFiles("src"), ...sourceFiles("web/src")]) {
  if (exemptPrefixes.some((prefix) => path.startsWith(prefix))) continue;
  lineCounts.set(path, lineCount(path));
}

describe("file size ceiling", () => {
  it("scans the source tree", () => {
    // Guards the scanner itself: a scan that finds nothing would pass every check below.
    expect(lineCounts.size).toBeGreaterThan(200);
  });

  it(`keeps new files at ${CEILING} lines or fewer`, () => {
    const offenders = [...lineCounts]
      .filter(([path, lines]) => lines > CEILING && !(path in overCeilingBaseline))
      .map(([path, lines]) => `${path}: ${lines} lines`);
    expect(offenders).toEqual([]);
  });

  it("does not let a file over the ceiling grow", () => {
    const grown = Object.entries(overCeilingBaseline)
      .filter(([path, allowed]) => (lineCounts.get(path) ?? 0) > allowed)
      .map(([path, allowed]) => `${path}: ${lineCounts.get(path)} lines, allowed ${allowed}`);
    expect(grown).toEqual([]);
  });

  it("drops baseline entries for files that are gone or now within the ceiling", () => {
    const stale = Object.keys(overCeilingBaseline).filter(
      (path) => (lineCounts.get(path) ?? 0) <= CEILING
    );
    expect(stale).toEqual([]);
  });
});
