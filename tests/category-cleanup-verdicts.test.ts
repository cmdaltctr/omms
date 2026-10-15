import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { CONFIG } = await import("../src/config.js");
const { saveVerdicts, loadVerdicts, pruneVerdicts, VERDICT_MAX_AGE_MS } =
  await import("../src/services/user-profile/category-cleanup-store.js");

let directory: string;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-category-verdicts-"));
  CONFIG.storagePath = directory;
});

afterEach(async () => {
  await tursoConnectionManager.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(directory, { recursive: true, force: true });
});

it("saves and loads verdicts per profile", async () => {
  await saveVerdicts(
    "p1",
    new Map([
      ["g1", { keep: ["Execution", "Direct execution"], name: "Execution" }],
      ["g2", { keep: ["Language"], name: null }],
    ])
  );
  await saveVerdicts("p2", new Map([["g1", { keep: ["Other"], name: "Other" }]]));
  const loaded = await loadVerdicts("p1");
  expect([...loaded.keys()].sort()).toEqual(["g1", "g2"]);
  expect(loaded.get("g1")).toEqual({ keep: ["Execution", "Direct execution"], name: "Execution" });
  expect(loaded.get("g2")).toEqual({ keep: ["Language"], name: null });
});

it("replaces the verdict saved under the same group id", async () => {
  await saveVerdicts("p1", new Map([["g1", { keep: ["A", "B"], name: "A" }]]));
  await saveVerdicts("p1", new Map([["g1", { keep: ["A", "B", "C"], name: "B" }]]));
  const loaded = await loadVerdicts("p1");
  expect(loaded.size).toBe(1);
  expect(loaded.get("g1")).toEqual({ keep: ["A", "B", "C"], name: "B" });
});

it("prunes verdicts of groups that no longer exist and keeps the rest", async () => {
  await saveVerdicts(
    "p1",
    new Map([
      ["g1", { keep: ["A", "B"], name: "A" }],
      ["g2", { keep: ["C", "D"], name: "C" }],
    ])
  );
  await saveVerdicts("p2", new Map([["g3", { keep: ["E", "F"], name: "E" }]]));
  await pruneVerdicts("p1", ["g1"]);
  expect([...(await loadVerdicts("p1")).keys()]).toEqual(["g1"]);
  expect([...(await loadVerdicts("p2")).keys()]).toEqual(["g3"]);
});

it("prunes verdicts older than the limit", async () => {
  const now = Date.now();
  await saveVerdicts("p1", new Map([["old", { keep: ["A", "B"], name: "A" }]]), now - 31 * DAY);
  await saveVerdicts("p1", new Map([["new", { keep: ["C", "D"], name: "C" }]]), now - 29 * DAY);
  expect(VERDICT_MAX_AGE_MS).toBe(30 * DAY);
  await pruneVerdicts("p1", ["old", "new"], VERDICT_MAX_AGE_MS, now);
  expect([...(await loadVerdicts("p1")).keys()]).toEqual(["new"]);
});

it("prunes more groups than one delete statement holds", async () => {
  const verdicts = new Map(
    Array.from(
      { length: 450 },
      (_, index) => [`g${index}`, { keep: ["A", "B"], name: "A" }] as const
    )
  );
  await saveVerdicts("p1", verdicts);
  await pruneVerdicts("p1", ["g0", "g449"]);
  expect([...(await loadVerdicts("p1")).keys()].sort()).toEqual(["g0", "g449"]);
});

it("skips a row whose keep value is not a JSON array and loads the rest", async () => {
  await saveVerdicts(
    "p1",
    new Map([
      ["good", { keep: ["A", "B"], name: "A" }],
      ["bad-json", { keep: ["C", "D"], name: "C" }],
      ["not-array", { keep: ["E", "F"], name: "E" }],
      ["mixed", { keep: ["G", "H"], name: "G" }],
    ])
  );
  const db = await tursoConnectionManager.getConnection(join(directory, "user-profiles.db"));
  const set = (id: string, keep: string) =>
    db.execute("UPDATE profile_category_verdicts SET keep = ? WHERE group_id = ?", [keep, id]);
  await set("bad-json", "{not json");
  await set("not-array", JSON.stringify({ keep: ["E", "F"] }));
  await set("mixed", JSON.stringify(["G", 7, null, "H"]));
  const loaded = await loadVerdicts("p1");
  expect([...loaded.keys()].sort()).toEqual(["good", "mixed"]);
  expect(loaded.get("mixed")).toEqual({ keep: ["G", "H"], name: "G" });
});
