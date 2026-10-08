import { expect, it } from "bun:test";
import { importProfileFromHistory } from "../src/importer/profile-import.js";
import type { ImportSourceSession } from "../src/importer/importer.js";

const source: ImportSourceSession[] = [
  {
    sessionId: "same",
    directory: "/tmp",
    sourceFile: "fixture.jsonl",
    units: [
      "yes",
      "<private>confidential preference</private>",
      "use bun not npm",
      "Please improve the regression tests",
    ].map((userPrompt, index) => ({
      userPrompt,
      userEntryId: `u${index}`,
      sourceEntryIds: [`a${index}`],
      textResponses: ["done"],
      toolCalls: [],
    })),
  },
];

it("estimates only eligible non-trivial prompts after privacy filtering, without store or model writes", async () => {
  const identities: string[] = [];
  const ledgerKeys: string[] = [];
  const profile = await importProfileFromHistory(source, {
    host: "pi",
    dryRun: true,
    ledger: {
      get: async () => {
        throw new Error("dry run must peek");
      },
      peek: async (key) => {
        ledgerKeys.push(key);
        return null;
      },
      begin: async () => {
        throw new Error("must not write");
      },
      complete: async () => {
        throw new Error("must not write");
      },
    },
    onEligiblePrompt: (identity) => identities.push(identity),
    model: {
      provider: "test",
      modelId: "test",
      complete: async () => {
        throw new Error("must not call model");
      },
    },
  });
  expect(profile.promptsWouldRecord).toBe(3);
  expect(identities).toEqual([JSON.stringify(["same", "u2"]), JSON.stringify(["same", "u3"])]);
  expect(ledgerKeys).not.toContain("pi:same:u1:a1#profile");
});

it("keeps host ledger keys distinct and honours the existing once-only forced replay identity", async () => {
  const done = new Set([
    "pi:same:u2:a2#profile",
    "pi:same:u2:a2#profile-rebuild",
    "claude-code:same:u2:a2#profile",
  ]);
  const counts: number[] = [];
  const eligible: string[][] = [];
  for (const host of ["pi", "claude-code"] as const) {
    const identities: string[] = [];
    const result = await importProfileFromHistory(
      [{ ...source[0]!, units: [source[0]!.units[2]!] }],
      {
        host,
        dryRun: true,
        force: true,
        onEligiblePrompt: (identity) => identities.push(identity),
        ledger: {
          get: async () => {
            throw new Error("must peek");
          },
          peek: async (key) => (done.has(key) ? ({ status: "imported" } as never) : null),
          begin: async () => {
            throw new Error("must not write");
          },
          complete: async () => {
            throw new Error("must not write");
          },
        },
      }
    );
    counts.push(result.promptsWouldRecord);
    eligible.push(identities);
  }
  expect(counts).toEqual([0, 1]);
  expect(eligible).toEqual([[], [JSON.stringify(["same", "u2"])]]);
});
