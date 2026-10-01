import { afterAll, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import {
  CatchUpLease,
  LEASE_EXPIRY_MS,
} from "../src/services/user-prompt/profile-catch-up-lease.js";

const dir = mkdtempSync(join(tmpdir(), "omms-catch-up-lease-"));
CONFIG.storagePath = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let clock = 1_000_000;
let file = 0;
function lease() {
  return new CatchUpLease({
    path: join(dir, `user-prompts-${file++}.db`),
    now: () => clock,
    // Each wait moves the clock, so tests never sleep for real.
    sleep: async (ms) => {
      clock += ms;
    },
  });
}

it("lets the newest run take over; the older run stops before its next batch", async () => {
  const store = lease();
  await store.take("old");
  expect(await store.beginBatch("old")).toBe("ok");
  await store.endBatch("old");
  await store.take("new");
  expect(await store.beginBatch("old")).toBe("superseded");
  expect(await store.beginBatch("new")).toBe("ok");
  expect(await store.isActive()).toBe(true);
  await store.endBatch("new");
  await store.release("new");
  expect(await store.isActive()).toBe(false);
});

it("makes the newer run wait until the older run's batch ends", async () => {
  const store = lease();
  await store.take("old");
  expect(await store.beginBatch("old")).toBe("ok");
  await store.take("new");
  let waited = false;
  const newer = store.beginBatch("new", {
    onWait: () => {
      waited = true;
      // The older run finishes its batch while the newer one waits.
      void store.endBatch("old");
    },
  });
  expect(await newer).toBe("ok");
  expect(waited).toBe(true);
  // The older run's release must not remove the newer run's record.
  await store.release("old");
  expect(await store.isActive()).toBe(true);
});

it("expires a record that was not refreshed for 10 minutes", async () => {
  const store = lease();
  await store.take("crashed");
  expect(await store.beginBatch("crashed")).toBe("ok");
  clock += LEASE_EXPIRY_MS + 1;
  expect(await store.isActive()).toBe(false);
  await store.take("next");
  expect(await store.beginBatch("next")).toBe("ok");
});

it("stops waiting when the run is aborted", async () => {
  const store = lease();
  await store.take("old");
  await store.beginBatch("old");
  await store.take("new");
  const controller = new AbortController();
  const result = store.beginBatch("new", {
    signal: controller.signal,
    onWait: () => controller.abort(),
  });
  expect(await result).toBe("aborted");
});
