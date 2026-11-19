import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The Default column of the Settings catalogue must match what the server uses when the
// config file sets nothing. The config loads in a child process with an empty config file.
const home = mkdtempSync(join(tmpdir(), "omms-catalogue-defaults-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

type Row = { key: string; text: string; value: unknown; unset: boolean };

async function rows(): Promise<Row[]> {
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(join(home, ".config", "omms", "omms.jsonc"), "{}\n");
  const config = pathToFileURL(join(import.meta.dir, "../src/config.ts")).href;
  const catalogue = pathToFileURL(
    join(import.meta.dir, "../web/src/lib/settings-catalogue.ts")
  ).href;
  const script = join(home, "dump.mjs");
  writeFileSync(
    script,
    `const cfg = await import(${JSON.stringify(config)});
     const { SETTINGS_CATALOGUE } = await import(${JSON.stringify(catalogue)});
     const get = (key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), cfg.CONFIG);
     console.log("ROWS:" + JSON.stringify(SETTINGS_CATALOGUE.map((entry) => {
       const value = get(entry.key);
       return { key: entry.key, text: entry.default, value: value ?? null, unset: value === undefined };
     })));`
  );
  const proc = Bun.spawn(["bun", "run", script], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_SKIP_LEGACY_MIGRATION: "1",
      OMMS_DISABLE_WEB_AUTOSTART: "1",
    },
  });
  const output = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(output.match(/ROWS:(.*)$/m)![1]!);
}

/** Words the page shows for a fixed value. */
const WORDS: Record<string, string> = {
  project: "This project",
  "openai-chat": "OpenAI Chat Completions",
  inherit: "Session model",
  boost: "Add a bonus for word matches",
  characters: "Characters",
  add: "Add a new one",
  "Xenova/nomic-embed-text-v1": "Built-in nomic-embed-text",
};

/** Words for a value whose label depends on the key, such as `learn`. */
const KEY_WORDS: Record<string, Record<string, string>> = {
  userProfileWithoutEmail: { learn: "Learn anyway" },
  userProfilePromptDetail: { full: "Prompts with profile and guidance" },
  userProfileDuringCatchUp: { learn: "Keep learning" },
};

/** Keys whose unset value means a rule, not "Not set". */
const UNSET_MEANS: Record<string, string> = {
  opencodeProvider: "External API, else the session model",
  opencodeModel: "External API, else the session model",
  piProvider: "External API, else the session model",
  piModel: "External API, else the session model",
  autoCaptureLanguage: "Same as the conversation",
  skillFolders: "The usual skill folders",
};

/** Defaults that depend on the machine or the chosen model, so no plain comparison exists. */
const NOT_COMPARABLE = new Set(["embeddingDimensions", "claudeConfigDir"]);

function expected(row: Row): string | RegExp {
  const { key, value } = row;
  if (row.unset) return UNSET_MEANS[key] ?? /^Not set/;
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value) && value.length === 0) return "None";
  if (typeof value === "number") {
    if (key.endsWith("Bytes")) return new RegExp(`^${value / 1024} KB\\b`);
    if (key.endsWith("Ms")) return new RegExp(`^${value / 1000} seconds?\\b`);
    return new RegExp(`^${value.toLocaleString("en-US").replace(".", "\\.")}\\b`);
  }
  if (typeof value === "string") return KEY_WORDS[key]?.[value] ?? WORDS[value] ?? value;
  throw new Error(`No rule for ${key}`);
}

it("shows the real server default for every catalogue entry it can compare", async () => {
  const wrong: string[] = [];
  const all = await rows();
  for (const row of all) {
    if (NOT_COMPARABLE.has(row.key)) continue;
    const want = expected(row);
    const ok = typeof want === "string" ? row.text === want : want.test(row.text);
    if (!ok) wrong.push(`${row.key}: shows "${row.text}", server default ${String(want)}`);
  }
  expect(wrong).toEqual([]);
  // Every entry is either compared or named as not comparable.
  expect(all.filter((row) => NOT_COMPARABLE.has(row.key)).map((row) => row.key)).toEqual([
    "embeddingDimensions",
    "claudeConfigDir",
  ]);
});
