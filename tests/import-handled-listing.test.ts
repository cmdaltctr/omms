import { afterEach, beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { ImportLedger } from "../src/importer/ledger.js";
import {
  handledKeys,
  listImportSessions,
  resolveImportSelection,
  validateImportSelection,
  validateSessionListRequest,
  type ImportMatchOptions,
} from "../src/importer/import-sessions.js";
import { validateImportSource } from "../src/importer/import-sources.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { makeProjectDir, writeV3Session } from "./pi-import-fixtures.js";

setDefaultTimeout(30_000);

let base: string;
let root: string;
let projectA: string;
let previousStorage: string;
let source: ReturnType<typeof validateImportSource>;
let match: ImportMatchOptions;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omms-handled-listing-"));
  previousStorage = CONFIG.storagePath;
  CONFIG.storagePath = join(base, "storage");
  mkdirSync(CONFIG.storagePath, { recursive: true });
  root = join(base, "sessions");
  mkdirSync(root, { recursive: true });
  projectA = makeProjectDir(base, "project-a");
  for (const id of ["one", "two", "three"]) {
    writeV3Session({
      file: join(root, `${id}.jsonl`),
      sessionId: `sess-${id}`,
      cwd: projectA,
      windows: [{ userText: id, assistantText: "ok", timestamp: "2026-01-01T10:00:00.000Z" }],
    });
  }
  source = validateImportSource("pi", root);
  // Project memories only, so "one" and "two" are handled and "three" has a failed row.
  match = {
    host: "pi",
    scope: "all-projects",
    pathMaps: [],
    cwd: projectA,
    outputs: { memories: true, profile: false },
  };
});

afterEach(async () => {
  await tursoConnectionManager.closeConnection(join(CONFIG.storagePath, "import-ledger.db"));
  CONFIG.storagePath = previousStorage;
  rmSync(base, { recursive: true, force: true });
});

/** Mark "one" and "two" handled for memories; "two" also for profile; "three" has a failed row. */
async function seedLedger() {
  const ledger = new ImportLedger();
  const put = async (key: string, session: string, hash: string, end: "imported" | "failed") => {
    await ledger.begin({ key, sessionId: session, sourceFile: "f", projectHash: hash });
    if (end === "imported") await ledger.complete(key, "m");
    else await ledger.fail(key, "boom");
  };
  await put("pi:1", "sess-one", "h", "imported");
  await put("pi:2", "sess-two", "h", "imported");
  await put("pi:2#profile", "sess-two", "profile", "imported");
  await put("pi:3", "sess-three", "h", "failed");
}

const list = (extra: Record<string, unknown> = {}, options: ImportMatchOptions = match) =>
  listImportSessions({ sourceToken: source.sourceToken, refresh: true, ...extra }, options);

it("hides handled sessions by default and reports how many are hidden", async () => {
  await seedLedger();
  const page = await list();
  expect(page.rows.map((row) => row.key)).toEqual(["three.jsonl"]);
  expect(page.total).toBe(1);
  expect(page.hiddenHandled).toBe(2);
});

it("splits handled by ticked output", async () => {
  await seedLedger();
  const both = await list({}, { ...match, outputs: { memories: true, profile: true } });
  expect(both.rows.map((row) => row.key).sort()).toEqual(["one.jsonl", "three.jsonl"]);
  expect(both.hiddenHandled).toBe(1);
  const profileOnly = await list({}, { ...match, outputs: { memories: false, profile: true } });
  expect(profileOnly.rows.map((row) => row.key).sort()).toEqual(["one.jsonl", "three.jsonl"]);
  const none = await list({}, { ...match, outputs: { memories: false, profile: false } });
  expect(none.hiddenHandled).toBe(0);
});

it("keeps handled sessions marked when includeHandled or force is set", async () => {
  await seedLedger();
  const shown = await list({ includeHandled: true });
  expect(shown.total).toBe(3);
  expect(shown.hiddenHandled).toBe(0);
  expect(Object.fromEntries(shown.rows.map((row) => [row.key, row.handled]))).toEqual({
    "one.jsonl": true,
    "two.jsonl": true,
    "three.jsonl": false,
  });
  const forced = await list({}, { ...match, force: true });
  expect(forced.total).toBe(3);
});

it("does not change the revision when handled sessions are hidden", async () => {
  await seedLedger();
  const hidden = await list();
  const shown = await list({ includeHandled: true });
  expect(hidden.revision).toBe(shown.revision);
});

it("lists nothing handled when the ledger does not exist", async () => {
  const page = await list();
  expect(page.total).toBe(3);
  expect(page.hiddenHandled).toBe(0);
});

it("drops handled sessions from an all selection unless includeHandled or force", async () => {
  await seedLedger();
  const page = await list();
  const all = {
    mode: "all" as const,
    excludedKeys: [],
    revision: page.revision,
    listedAt: page.listedAt,
  };
  const dropped = await resolveImportSelection(source.sourceToken, all, match);
  expect(dropped.keys).toEqual(["three.jsonl"]);
  const kept = await resolveImportSelection(
    source.sourceToken,
    { ...all, includeHandled: true },
    match
  );
  expect(kept.keys.sort()).toEqual(["one.jsonl", "three.jsonl", "two.jsonl"]);
  const forced = await resolveImportSelection(source.sourceToken, all, { ...match, force: true });
  expect(forced.keys).toHaveLength(3);
});

it("reads the new request fields and keeps older callers working", () => {
  const plain = validateSessionListRequest({ host: "pi" });
  expect(plain.includeHandled).toBe(false);
  expect(plain.match.outputs).toEqual({ memories: true, profile: true });
  const forced = validateSessionListRequest({ host: "pi", force: true, skipMemories: true });
  expect(forced.includeHandled).toBe(true);
  expect(forced.match.outputs).toEqual({ memories: false, profile: true });
  expect(() => validateSessionListRequest({ host: "pi", force: "yes" })).toThrow();
  const selection = validateImportSelection({
    mode: "all",
    revision: "r",
    listedAt: 1,
    includeHandled: true,
  });
  expect(selection).toMatchObject({ includeHandled: true });
});

it("looks up handled by session id for every host's key shape and never for a null id", async () => {
  await seedLedger();
  const via = { kind: "recorded" } as never;
  const row = (key: string, sessionId: string | null) => ({
    key,
    sessionId,
    createdAt: 1,
    recordedDirectory: null,
    directory: projectA,
    via,
  });
  const rows = [
    row("sess-one", "sess-one"), // OpenCode: the key is the session id
    row("sub/two.jsonl", "sess-two"), // Pi and Claude Code: the key is a file path
    row("three.jsonl", "sess-three"), // failed row
    row("orphan.jsonl", null), // no session id
  ];
  const handled = await handledKeys(rows, { memories: true, profile: false });
  expect([...handled].sort()).toEqual(["sess-one", "sub/two.jsonl"]);
});
