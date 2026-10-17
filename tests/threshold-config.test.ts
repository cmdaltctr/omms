import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const configUrl = pathToFileURL(join(import.meta.dir, "../src/config.js")).href;
const jsoncUrl = pathToFileURL(join(import.meta.dir, "../src/services/jsonc.js")).href;

/** Same child-process pattern as memory-limits-config.test.ts (temp HOME). */
async function thresholdScenario(files: { global?: string }, body: string): Promise<any> {
  const home = mkdtempSync(join(tmpdir(), "omms-threshold-home-"));
  tempDirs.push(home);
  const project = mkdtempSync(join(tmpdir(), "omms-threshold-project-"));
  tempDirs.push(project);
  const globalPath = join(home, ".config", "omms", "omms.jsonc");
  if (files.global !== undefined) {
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(globalPath, files.global);
  }
  const script = `
const { readFileSync, writeFileSync } = await import("node:fs");
const cfg = await import(${JSON.stringify(configUrl)});
const { stripJsoncComments } = await import(${JSON.stringify(jsoncUrl)});
const home = ${JSON.stringify(home)};
const globalPath = ${JSON.stringify(globalPath)};
const project = ${JSON.stringify(project)};
try {
  const result = await (async () => { ${body} })();
  console.log("THRESHOLD_RESULT:" + JSON.stringify(result));
} catch (error) {
  console.log("THRESHOLD_RESULT:" + JSON.stringify({ error: String(error) }));
}
`;
  const dir = mkdtempSync(join(tmpdir(), "omms-threshold-script-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_SKIP_LEGACY_MIGRATION: "1" },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/THRESHOLD_RESULT:(.*)$/m);
  if (!match) throw new Error(text);
  return JSON.parse(match[1]);
}

describe("similarityThreshold file configuration", () => {
  it("uses the embedder default when the file omits the key", async () => {
    const result = await thresholdScenario(
      { global: "{}\n" },
      `
      cfg.initConfig(project);
      const withDefaultEmbedder = cfg.CONFIG.similarityThreshold;
      writeFileSync(globalPath, JSON.stringify({ embeddingModel: "qwen3-embedding:0.6b" }));
      cfg.refreshConfigIfChanged(project);
      const withQwen = cfg.CONFIG.similarityThreshold;
      writeFileSync(globalPath, JSON.stringify({ embeddingModel: "Xenova/nomic-embed-text-v1" }));
      cfg.refreshConfigIfChanged(project);
      return { withQwen, withDefaultEmbedder, backToDefault: cfg.CONFIG.similarityThreshold };
    `
    );
    expect(result).toEqual({ withQwen: 0.5, withDefaultEmbedder: 0.6, backToDefault: 0.6 });
  });

  it("keeps an explicit 0.6 on every embedder and never rewrites the file", async () => {
    const result = await thresholdScenario(
      { global: JSON.stringify({ similarityThreshold: 0.6 }) },
      `
      cfg.initConfig(project);
      const withQwen = cfg.CONFIG.similarityThreshold;
      writeFileSync(globalPath, JSON.stringify({
        similarityThreshold: 0.6,
        embeddingModel: "qwen3-embedding:0.6b",
      }));
      cfg.refreshConfigIfChanged(project);
      return { withQwen, afterEmbedderChange: cfg.CONFIG.similarityThreshold };
    `
    );
    expect(result).toEqual({ withQwen: 0.6, afterEmbedderChange: 0.6 });
  });

  it("accepts a decimal value inside the range", async () => {
    const result = await thresholdScenario(
      { global: JSON.stringify({ similarityThreshold: 0.45 }) },
      `
      cfg.initConfig(project);
      return { threshold: cfg.CONFIG.similarityThreshold };
    `
    );
    expect(result).toEqual({ threshold: 0.45 });
  });

  it("refuses -0.1, 1.1, null, and a string, naming the setting and its range", async () => {
    const result = await thresholdScenario(
      { global: "{}\n" },
      `
      const invalid = [-0.1, 1.1, null, "0.5"];
      const rows = invalid.map((value) => {
        try { cfg.validateGlobalConfig({ similarityThreshold: value }); return { value, error: null }; }
        catch (error) { return { value, error: String(error) }; }
      });
      return { rows };
    `
    );
    for (const row of result.rows) {
      expect(row.error, `${JSON.stringify(row.value)} must be rejected`).not.toBeNull();
      expect(row.error).toContain("similarityThreshold");
      expect(row.error).toContain("0 to 1");
      // Metadata-only: the value itself is never quoted back.
      expect(row.error).not.toContain(String(row.value));
    }
  });

  it("writes no active similarityThreshold line into a new file", async () => {
    const result = await thresholdScenario(
      {},
      `
      const text = readFileSync(globalPath, "utf8");
      const parsed = JSON.parse(stripJsoncComments(text));
      return {
        hasKey: parsed.similarityThreshold !== undefined,
        hasActiveLine: /^\\s*"similarityThreshold"\\s*:/m.test(text),
      };
    `
    );
    expect(result).toEqual({ hasKey: false, hasActiveLine: false });
  });
});
