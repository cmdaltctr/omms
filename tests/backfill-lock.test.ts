import { afterEach, expect, it } from "bun:test";
import type { InArgs } from "@libsql/client";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG } from "../src/config.js";
import { getBackfillCutoff } from "../src/services/backfill-state.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";
import { tryAcquireBackfillLock } from "../src/importer/backfill-lock.js";

const previousStorage = CONFIG.storagePath;
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await cleanupTursoTestDirectory(directory);
  CONFIG.storagePath = previousStorage;
});

it("refuses a second process while the holder is alive, then releases", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-backfill-lock-"));
  directories.push(home);
  CONFIG.storagePath = home;
  const release = await tryAcquireBackfillLock("pi", home);
  expect(release).not.toBeNull();
  expect(await getBackfillCutoff("pi", 100)).toBe(100);
  const script = join(home, "child.mjs");
  const moduleUrl = pathToFileURL(join(import.meta.dir, "../src/importer/backfill-lock.ts")).href;
  writeFileSync(
    script,
    `const { CONFIG } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
    CONFIG.storagePath = ${JSON.stringify(home)};
    const { tryAcquireBackfillLock } = await import(${JSON.stringify(moduleUrl)});
    const release = await tryAcquireBackfillLock("pi", ${JSON.stringify(home)});
    console.log(release ? "acquired" : "refused"); await release?.();`
  );
  const child = Bun.spawn(["bun", "run", script], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(output.trim().split("\n").at(-1)).toBe("refused");
  await release!();
  const next = await tryAcquireBackfillLock("pi", home);
  expect(next).not.toBeNull();
  await next!();
});

it("reclaims a dead PID without affecting the other host", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-backfill-stale-"));
  directories.push(home);
  CONFIG.storagePath = home;
  const db = await tursoConnectionManager.getConnection(join(home, "import-ledger.db"));
  await db.run(
    "CREATE TABLE backfill_locks (host TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL)"
  );
  await db.run("INSERT INTO backfill_locks VALUES ('pi', 2147483647, 'old')");
  const release = await tryAcquireBackfillLock("pi", home);
  expect(release).not.toBeNull();
  const other = await tryAcquireBackfillLock("opencode", home);
  expect(other).not.toBeNull();
  const owner = await db.get<{ token: string }>(
    "SELECT token FROM backfill_locks WHERE host = 'pi'"
  );
  expect(owner?.token).not.toBe("old");
  await release!();
  expect(await db.get("SELECT 1 FROM backfill_locks WHERE host = 'pi'")).toBeNull();
  expect(await db.get("SELECT 1 FROM backfill_locks WHERE host = 'opencode'")).not.toBeNull();
  await other!();
});

it("gives one contender a stale claim and preserves a replacement on old release", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-backfill-race-"));
  directories.push(home);
  CONFIG.storagePath = home;
  const db = await tursoConnectionManager.getConnection(join(home, "import-ledger.db"));
  await db.run(
    "CREATE TABLE backfill_locks (host TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL)"
  );
  await db.run("INSERT INTO backfill_locks VALUES ('pi', 2147483647, 'stale')");
  const contenders = await Promise.all(
    Array.from({ length: 8 }, () => tryAcquireBackfillLock("pi", home))
  );
  const winners = contenders.filter((release) => release !== null);
  expect(winners).toHaveLength(1);
  const row = await db.get<{ pid: number; token: string }>(
    "SELECT pid, token FROM backfill_locks WHERE host = 'pi'"
  );
  expect(row?.pid).toBe(process.pid);
  expect(row?.token).not.toBe("stale");
  await db.run("UPDATE backfill_locks SET token = 'replacement' WHERE host = 'pi'");
  await winners[0]!();
  expect(
    (await db.get<{ token: string }>("SELECT token FROM backfill_locks WHERE host = 'pi'"))?.token
  ).toBe("replacement");
});

it("rejects a stale claim update after another contender has replaced its token", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-backfill-token-race-"));
  directories.push(home);
  CONFIG.storagePath = home;
  const db = await tursoConnectionManager.getConnection(join(home, "import-ledger.db"));
  await db.run(
    "CREATE TABLE backfill_locks (host TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL)"
  );
  await db.run("INSERT INTO backfill_locks VALUES ('pi', 2147483647, 'stale')");
  const originalGet = db.get.bind(db);
  let reads = 0;
  let unblock!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  db.get = async <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    args?: InArgs
  ): Promise<T | null> => {
    const row = await originalGet<T>(sql, args);
    if (sql.startsWith("SELECT pid, token FROM backfill_locks")) {
      if (++reads === 2) unblock();
      await bothRead;
    }
    return row;
  };
  const claims = await Promise.all([
    tryAcquireBackfillLock("pi", home),
    tryAcquireBackfillLock("pi", home),
  ]);
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  await claims.find((claim) => claim !== null)!();
});

it("lets only one process replace a stale claim", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-backfill-process-race-"));
  directories.push(home);
  CONFIG.storagePath = home;
  const db = await tursoConnectionManager.getConnection(join(home, "import-ledger.db"));
  await db.run(
    "CREATE TABLE backfill_locks (host TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL)"
  );
  await db.run("INSERT INTO backfill_locks VALUES ('pi', 2147483647, 'stale')");
  const script = join(home, "contender.mjs");
  const moduleUrl = pathToFileURL(join(import.meta.dir, "../src/importer/backfill-lock.ts")).href;
  writeFileSync(
    script,
    `const { existsSync, writeFileSync } = await import("node:fs");
    const { CONFIG } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
    CONFIG.storagePath = ${JSON.stringify(home)};
    const { tryAcquireBackfillLock } = await import(${JSON.stringify(moduleUrl)});
    const { join } = await import("node:path");
    const id = process.env.OMMS_CONTENDER;
    writeFileSync(join(${JSON.stringify(home)}, "ready-" + id), "ready");
    while (!existsSync(join(${JSON.stringify(home)}, "go"))) await Bun.sleep(10);
    const release = await tryAcquireBackfillLock("pi", ${JSON.stringify(home)});
    writeFileSync(join(${JSON.stringify(home)}, "outcome-" + id), release ? "acquired" : "refused");
    while (release && !existsSync(join(${JSON.stringify(home)}, "release"))) await Bun.sleep(10);
    await release?.();`
  );
  const children = ["a", "b"].map((id) =>
    Bun.spawn(["bun", "run", script], {
      cwd: home,
      env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_CONTENDER: id },
    })
  );
  try {
    for (
      let i = 0;
      i < 200 && !(existsSync(join(home, "ready-a")) && existsSync(join(home, "ready-b")));
      i++
    )
      await Bun.sleep(10);
    expect(existsSync(join(home, "ready-a")) && existsSync(join(home, "ready-b"))).toBe(true);
    writeFileSync(join(home, "go"), "go");
    for (
      let i = 0;
      i < 200 && !(existsSync(join(home, "outcome-a")) && existsSync(join(home, "outcome-b")));
      i++
    )
      await Bun.sleep(10);
    expect(existsSync(join(home, "outcome-a")) && existsSync(join(home, "outcome-b"))).toBe(true);
    const { readFileSync } = await import("node:fs");
    expect(
      ["a", "b"].map((id) => readFileSync(join(home, "outcome-" + id), "utf8")).sort()
    ).toEqual(["acquired", "refused"]);
  } finally {
    writeFileSync(join(home, "release"), "release");
    for (const child of children) {
      if ((await Promise.race([child.exited, Bun.sleep(1000).then(() => null)])) === null)
        child.kill();
      await child.exited;
    }
  }
  expect(await db.get("SELECT 1 FROM backfill_locks WHERE host = 'pi'")).toBeNull();
}, 10_000);

it("reclaims a claim left by a terminated process", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-backfill-crash-"));
  directories.push(home);
  CONFIG.storagePath = home;
  const marker = join(home, "owned");
  const script = join(home, "owner.mjs");
  const moduleUrl = pathToFileURL(join(import.meta.dir, "../src/importer/backfill-lock.ts")).href;
  writeFileSync(
    script,
    `const { writeFileSync } = await import("node:fs");
    const { CONFIG } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/config.ts")).href)});
    CONFIG.storagePath = ${JSON.stringify(home)};
    const { tryAcquireBackfillLock } = await import(${JSON.stringify(moduleUrl)});
    const release = await tryAcquireBackfillLock("pi", ${JSON.stringify(home)});
    if (!release) throw new Error("claim refused");
    writeFileSync(${JSON.stringify(marker)}, "owned");
    setInterval(() => {}, 1000);`
  );
  const child = Bun.spawn(["bun", "run", script], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  try {
    for (let i = 0; i < 100 && !existsSync(marker); i++) await Bun.sleep(20);
    expect(existsSync(marker)).toBe(true);
  } finally {
    child.kill();
    await child.exited;
  }
  const release = await tryAcquireBackfillLock("pi", home);
  expect(release).not.toBeNull();
  await release!();
});
