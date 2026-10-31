import { afterAll, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import {
  PROFILE_FAILURE_WAIT_MS,
  createBackoff,
  profileBackoff,
  recordProfileFailure,
  skillDraftBackoff,
} from "../src/core/profile-backoff.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { LEASE_EXPIRY_MS, TableLease } from "../src/services/turso/table-lease.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const dir = mkdtempSync(join(tmpdir(), "omms-skill-draft-backoff-"));
CONFIG.storagePath = dir;
afterAll(() => cleanupTursoTestDirectory(dir));

it("keeps skill drafting and profile learning on separate waits", () => {
  profileBackoff.recordSuccess();
  skillDraftBackoff.recordSuccess();

  skillDraftBackoff.recordFailure(1_000);
  expect(skillDraftBackoff.canRun(1_000 + 60_000)).toBe(false);
  expect(profileBackoff.canRun(1_000 + 60_000)).toBe(true);
  expect(skillDraftBackoff.canRun(1_000 + 10 * 60 * 1000)).toBe(true);
  skillDraftBackoff.recordSuccess();

  recordProfileFailure("pi", "pi profile learning: aborted", new Error("timeout"), 1_000);
  expect(profileBackoff.canRun(1_000 + 60_000)).toBe(false);
  expect(skillDraftBackoff.canRun(1_000 + 60_000)).toBe(true);
  profileBackoff.recordSuccess();
});

it("records a failure against a chosen backoff with the shared reason codes", () => {
  profileBackoff.recordSuccess();
  skillDraftBackoff.recordSuccess();
  expect(
    recordProfileFailure("pi", "skill draft failed", new Error("timeout"), 1_000, skillDraftBackoff)
  ).toBe("timeout");
  expect(skillDraftBackoff.canRun(1_000 + 60_000)).toBe(false);
  expect(profileBackoff.canRun(1_000 + 60_000)).toBe(true);
  skillDraftBackoff.recordSuccess();
});

it("gives each backoff its own wait", () => {
  const short = createBackoff(5_000);
  short.recordFailure(0);
  expect(short.canRun(4_999)).toBe(false);
  expect(short.canRun(5_000)).toBe(true);
  expect(PROFILE_FAILURE_WAIT_MS).toBe(10 * 60 * 1000);
});

let clock = 1_000_000;
function lease() {
  return new TableLease({
    table: "skill_review_lease",
    connection: () => tursoConnectionManager.getConnection(join(dir, "skills.db")),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
}

it("applies the catch-up take, wait, expiry and takeover rules to a second table", async () => {
  const store = lease();
  await store.take("old");
  expect(await store.beginBatch("old")).toBe("ok");
  await store.take("new");
  let waited = false;
  const newer = store.beginBatch("new", {
    onWait: () => {
      waited = true;
      void store.endBatch("old");
    },
  });
  expect(await newer).toBe("ok");
  expect(waited).toBe(true);
  expect(await store.beginBatch("old")).toBe("superseded");
  await store.release("old");
  expect(await store.isActive()).toBe(true);
  await store.endBatch("new");

  await store.take("crashed");
  expect(await store.beginBatch("crashed")).toBe("ok");
  clock += LEASE_EXPIRY_MS + 1;
  expect(await store.isActive()).toBe(false);
  await store.take("next");
  expect(await store.beginBatch("next")).toBe("ok");
  await store.endBatch("next");
  await store.release("next");
  expect(await store.isActive()).toBe(false);

  const db = await tursoConnectionManager.getConnection(join(dir, "skills.db"));
  const tables = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%lease%'"
  );
  expect(tables.map((row) => String(row.name))).toEqual(["skill_review_lease"]);
});
