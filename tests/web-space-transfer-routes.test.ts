import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, initConfig } from "../src/config.js";
import { getOrCreateAuthToken } from "../src/services/auth-token.js";
import {
  routeSpaceTransfers,
  type SpaceTransferRouteDeps,
  type SpaceTransferRouteResult,
} from "../src/services/space-transfer-routes.js";
import { routeSpaces } from "../src/services/space-routes.js";
import { WebServer } from "../src/services/web-server.js";
import {
  archiveStoredSpace,
  createStoredSpace,
  spaceFiles,
} from "../src/services/spaces/registry-store.js";
import { readRegistryFile } from "../src/services/spaces/registry.js";
import { openSpaceStore } from "../src/services/spaces/space-store.js";
import { tursoVectorSearch } from "../src/services/turso/vector-search.js";
import { exportSpace } from "../src/services/spaces/export-space.js";
import { IMPORT_MAX_FILE_BYTES } from "../src/services/spaces/import-space.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const HASH_A = "aaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbb";
const USER_HASH = "cccccccccccccccc";
const RANGE = { since: 10_000, until: 40_000 };
const EMBED_MODEL = "route-test-embed";

const omms = join(homedir(), ".omms");
const files = spaceFiles(omms);
const port = 49300 + (process.pid % 400);
let project: string;
let server: WebServer;

interface SeedRow {
  id: string;
  text: string;
  scope: "user" | "project";
  hash: string;
  createdAt: number;
  projectName?: string;
}

async function seed(folder: string, rows: SeedRow[]): Promise<void> {
  const store = openSpaceStore(folder, "write");
  try {
    for (const row of rows) {
      const shard = await store.shards.getWriteShard(row.scope, row.hash);
      const db = await store.connections.getConnection(shard.dbPath);
      await tursoVectorSearch.insertVector(db, {
        id: row.id,
        content: row.text,
        vector: new Float32Array([1, 0, 0, 0]),
        containerTag: `omms_${row.scope}_${row.hash}`,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
        ...(row.projectName ? { projectName: row.projectName } : {}),
      });
      await store.shards.incrementVectorCount(shard.id);
    }
  } finally {
    await store.close();
  }
}

async function readRows(folder: string): Promise<{ id: string; content: string }[]> {
  const store = openSpaceStore(folder, "read");
  try {
    const rows: { id: string; content: string }[] = [];
    for (const scope of ["user", "project"] as const) {
      for (const shard of await store.listShards(scope, "")) {
        if (!existsSync(shard.dbPath)) continue;
        const db = await store.openShard(shard.dbPath);
        for (const row of await db.all(`SELECT id, content FROM memories`)) {
          rows.push({ id: String(row.id), content: String(row.content) });
        }
      }
    }
    return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  } finally {
    await store.close();
  }
}

const alphaRows = (): SeedRow[] => [
  {
    id: "a-one",
    text: "probe project memory one",
    scope: "project",
    hash: HASH_A,
    createdAt: 10_000,
    projectName: "Alpha One",
  },
  {
    id: "a-two",
    text: "probe personal memory two",
    scope: "user",
    hash: USER_HASH,
    createdAt: 20_000,
  },
  {
    id: "a-three",
    text: "probe old memory three",
    scope: "project",
    hash: HASH_A,
    createdAt: 5_000,
    projectName: "Alpha One",
  },
  {
    id: "a-four",
    text: "probe second project memory four",
    scope: "project",
    hash: HASH_B,
    createdAt: 30_000,
    projectName: "Second Project",
  },
];

const request = (path: string, body: unknown) =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

type Result = SpaceTransferRouteResult | undefined;
const call = async (path: string, body: unknown, deps?: SpaceTransferRouteDeps) =>
  (await routeSpaceTransfers(path, "POST", request(path, body), project, deps)) as Result;
const data = (result: Result) => (result!.body as any).data;

/** Drawn ids of the spaces the suite creates, kept by display name. */
const spaceIds: Record<string, string> = {};
async function spaceId(name: string): Promise<string> {
  const space = await createStoredSpace(files, name);
  spaceIds[name] = space.id;
  return space.id;
}
const spaceFolder = (name: string) => join(omms, "spaces", spaceIds[name]!);

function exportDocument(model = EMBED_MODEL) {
  return {
    format: "omms-space-export",
    schemaVersion: 1,
    exportedAt: "2026-11-01T00:00:00.000Z",
    ommsVersion: "route-test",
    embedding: { model, dimensions: 4 },
    memories: [
      {
        id: "i-one",
        content: "imported project memory",
        scope: "project",
        projectTag: `omms_project_${HASH_A}`,
        createdAt: 1_000,
        updatedAt: 1_000,
        isPinned: false,
      },
      {
        id: "i-two",
        content: "imported personal memory",
        scope: "user",
        createdAt: 2_000,
        updatedAt: 2_000,
        isPinned: false,
      },
    ],
  };
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "omms-space-transfer-routes-"));
  initConfig(project);
  // Shards record these at creation, so every seeded vector is reusable as-is.
  CONFIG.embeddingModel = EMBED_MODEL;
  CONFIG.embeddingDimensions = 4;
  server = new WebServer({ enabled: true, host: "127.0.0.1", port, directory: project } as never);
  await server.start();
});

afterAll(async () => {
  await server.stop();
  await cleanupTursoTestDirectory(files.spacesRoot);
  await cleanupTursoTestDirectory(project);
  rmSync(files.registryPath, { force: true });
  rmSync(files.spacesRoot, { recursive: true, force: true });
  rmSync(files.backupsRoot, { recursive: true, force: true });
  rmSync(join(omms, "space-appearance"), { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

describe("transfer preview route", () => {
  beforeAll(async () => {
    await spaceId("Alpha");
    await spaceId("Beta");
    await seed(spaceFolder("Alpha"), alphaRows());
  });

  it("ignores paths it does not own", async () => {
    expect(await call("/api/memories", {})).toBeUndefined();
    expect(await call("/api/spaces/alpha/switch", {})).toBeUndefined();
  });

  it("returns the preview with groups, examples and duplicates", async () => {
    const result = await call("/api/spaces/transfer/preview", {
      from: "alpha",
      to: "beta",
      mode: "copy",
      ...RANGE,
    });
    expect(result!.status).toBe(200);
    const preview = data(result).preview;
    expect(preview.matched).toBe(3);
    expect(preview.toCopy).toBe(3);
    expect(preview.duplicates).toBe(0);
    // The engine groups in first-seen order; assert the set, not the order.
    expect([...preview.groups].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Alpha One", tag: `omms_project_${HASH_A}`, count: 1 },
      { name: "Personal", tag: `omms_user_${USER_HASH}`, count: 1 },
      { name: "Second Project", tag: `omms_project_${HASH_B}`, count: 1 },
    ]);
    expect(preview.examples).toHaveLength(3);
    expect(preview.examples[0].text.length).toBeLessThanOrEqual(160);
    expect(await readRows(spaceFolder("Beta"))).toEqual([]);
  });

  it("filters by one project tag and reports duplicates the target holds", async () => {
    await seed(spaceFolder("Beta"), [
      {
        id: "b-dup",
        text: "probe project memory one",
        scope: "project",
        hash: HASH_A,
        createdAt: 9_000,
        projectName: "Alpha One",
      },
    ]);
    const result = await call("/api/spaces/transfer/preview", {
      from: "alpha",
      to: "beta",
      since: 0,
      until: 60_000,
      projects: `omms_project_${HASH_A}`,
    });
    expect(result!.status).toBe(200);
    const preview = data(result).preview;
    expect(preview.matched).toBe(2);
    expect(preview.duplicates).toBe(1);
    expect(preview.toCopy).toBe(1);
  });

  it("refuses an unknown space, the same space and an archived space", async () => {
    const unknown = await call("/api/spaces/transfer/preview", {
      from: "ghost",
      to: "beta",
      ...RANGE,
    });
    expect(unknown!.status).toBe(404);
    expect(unknown!.body).toMatchObject({ success: false, code: "unknown-space" });

    const same = await call("/api/spaces/transfer/preview", {
      from: "alpha",
      to: "Alpha",
      ...RANGE,
    });
    expect(same!.status).toBe(400);
    expect(same!.body).toMatchObject({ success: false, code: "same-space" });

    await spaceId("Old Transfer");
    await archiveStoredSpace(files, spaceIds["Old Transfer"]!);
    const archived = await call("/api/spaces/transfer/preview", {
      from: "alpha",
      to: spaceIds["Old Transfer"]!,
      ...RANGE,
    });
    expect(archived!.status).toBe(409);
    expect(archived!.body).toMatchObject({ success: false, code: "archived-space" });
    expect(archived!.body.error).toContain("Old Transfer");
  });

  it("refuses a bad date and more than one project filter", async () => {
    const date = await call("/api/spaces/transfer/preview", {
      from: "alpha",
      to: "beta",
      since: "not a date",
      until: 60_000,
    });
    expect(date!.status).toBe(400);
    expect(date!.body).toMatchObject({ success: false, code: "invalid-date" });

    const projects = await call("/api/spaces/transfer/preview", {
      from: "alpha",
      to: "beta",
      since: 0,
      until: 60_000,
      projects: [`omms_project_${HASH_A}`, `omms_project_${HASH_B}`],
    });
    expect(projects!.status).toBe(400);
    expect(projects!.body).toMatchObject({ success: false, code: "invalid" });
  });
});

describe("transfer apply route", () => {
  it("refuses a missing confirm and an unknown mode", async () => {
    const noConfirm = await call("/api/spaces/transfer", {
      from: "alpha",
      to: "beta",
      mode: "copy",
      ...RANGE,
    });
    expect(noConfirm!.status).toBe(400);
    expect(noConfirm!.body).toMatchObject({ success: false, code: "confirm-required" });

    const badMode = await call("/api/spaces/transfer", {
      from: "alpha",
      to: "beta",
      mode: "swap",
      confirm: true,
      ...RANGE,
    });
    expect(badMode!.status).toBe(400);
    expect(badMode!.body).toMatchObject({ success: false, code: "invalid" });
  });

  it("copies without changing the source", async () => {
    await spaceId("Gamma");
    const result = await call("/api/spaces/transfer", {
      from: "alpha",
      to: "gamma",
      mode: "copy",
      confirm: true,
      ...RANGE,
    });
    expect(result!.status).toBe(200);
    const applied = data(result).result;
    expect(applied).toMatchObject({ ok: true, mode: "copy", copied: 3, skipped: 0, removed: 0 });
    expect((await readRows(spaceFolder("Alpha"))).length).toBe(4);
    expect((await readRows(spaceFolder("Gamma"))).length).toBe(3);
  });

  it("moves: the web route allows what the agent tool refuses", async () => {
    await spaceId("Delta");
    const result = await call("/api/spaces/transfer", {
      from: "alpha",
      to: "delta",
      mode: "move",
      confirm: true,
      ...RANGE,
    });
    expect(result!.status).toBe(200);
    const applied = data(result).result;
    expect(applied).toMatchObject({ ok: true, mode: "move", copied: 3, removed: 3 });
    const source = await readRows(spaceFolder("Alpha"));
    expect(source.map((row) => row.id)).toEqual(["a-three"]);
    expect((await readRows(spaceFolder("Delta"))).length).toBe(3);
  });

  it("answers 409 transfer-busy to a second apply and lets previews run", async () => {
    await spaceId("Busy Source");
    await spaceId("Busy Target");
    await seed(
      spaceFolder("Busy Source"),
      alphaRows().map((row) => ({ ...row, id: `busy-${row.id}` }))
    );
    // A model change after seeding forces the engine to embed again, which is
    // the seam this test uses to hold the first apply open.
    const recordedModel = CONFIG.embeddingModel;
    CONFIG.embeddingModel = `${recordedModel}-v2`;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started: () => void = () => {};
    const entered = new Promise<void>((resolve) => (started = resolve));
    const deps: SpaceTransferRouteDeps = {
      embed: async () => {
        started();
        await gate;
        return new Float32Array([0.25, 0.25, 0.25, 0.25]);
      },
    };
    try {
      const body = {
        from: spaceIds["Busy Source"]!,
        to: spaceIds["Busy Target"]!,
        mode: "copy",
        confirm: true,
        ...RANGE,
      };
      const first = call("/api/spaces/transfer", body, deps);
      await entered;
      const second = await call("/api/spaces/transfer", body);
      expect(second!.status).toBe(409);
      expect(second!.body).toMatchObject({ success: false, code: "transfer-busy" });
      const preview = await call("/api/spaces/transfer/preview", { ...body, mode: "copy" });
      expect(preview!.status).toBe(200);
      expect(data(preview).preview.matched).toBe(3);
      release();
      const finished = await first;
      expect(finished!.status).toBe(200);
      expect(data(finished).result.copied).toBe(3);
      expect((await readRows(spaceFolder("Busy Target"))).length).toBe(3);
      expect((await readRows(spaceFolder("Busy Source"))).length).toBe(4);
    } finally {
      release();
      CONFIG.embeddingModel = recordedModel;
    }
  });
});

describe("export download route", () => {
  beforeAll(async () => {
    await spaceId("Export Space");
    await spaceId("Empty Space");
    await seed(spaceFolder("Export Space"), [
      {
        id: "e-one",
        text: "export probe one",
        scope: "project",
        hash: HASH_A,
        createdAt: 10_000,
        projectName: "Exported",
      },
      {
        id: "e-two",
        text: "export probe two",
        scope: "project",
        hash: HASH_B,
        createdAt: 20_000,
        projectName: "Second Exported",
      },
    ]);
  });

  it("refuses an unknown space", async () => {
    const result = await call("/api/spaces/ghost/export", {});
    expect(result!.status).toBe(404);
    expect(result!.body).toMatchObject({ success: false, code: "unknown" });
  });

  it("returns written:false and no download for an empty selection", async () => {
    const result = await call(`/api/spaces/${spaceIds["Empty Space"]}/export`, {});
    expect(result!.status).toBe(200);
    expect(data(result).written).toBe(false);
    expect(typeof data(result).reason).toBe("string");
  });

  it("streams the file as an attachment with the same bytes the CLI writes", async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/spaces/${spaceIds["Export Space"]}/export`,
      {
        method: "POST",
        headers: { "x-omms-token": getOrCreateAuthToken(), "content-type": "application/json" },
        body: "{}",
      }
    );
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(
      new RegExp(
        `^attachment; filename="omms-space-export-${spaceIds["Export Space"]}-[^"]+\\.json"$`
      )
    );
    const info = JSON.parse(response.headers.get("x-omms-export-info") ?? "{}");
    expect(info.counts).toMatchObject({ projectMemories: 2, userMemories: 0 });
    expect(Array.isArray(info.warnings)).toBe(true);

    const downloaded = JSON.parse(await response.text());
    const cliPath = join(project, "cli-export.json");
    const cli = await exportSpace({
      folder: spaceFolder("Export Space"),
      outPath: cliPath,
      embeddingModel: downloaded.embedding.model,
      embeddingDimensions: downloaded.embedding.dimensions,
      ommsVersion: downloaded.ommsVersion,
      homePath: homedir(),
    });
    expect(cli.written).toBe(true);
    const { exportedAt: routeAt, ...routeDoc } = downloaded;
    const { exportedAt: _cliAt, ...cliDoc } = JSON.parse(await Bun.file(cliPath).text()) as Record<
      string,
      unknown
    >;
    // exportedAt is stamped per write, so compare it as a field, not across runs.
    expect(typeof routeAt).toBe("string");
    expect(routeDoc).toEqual(cliDoc);
    // The temporary file behind the download is gone.
    const leftovers = readdirSync(tmpdir()).filter((name) =>
      name.startsWith(`omms-space-export-${spaceIds["Export Space"]}-`)
    );
    expect(leftovers).toEqual([]);
  });
});

describe("import routes", () => {
  const fakeEmbed: SpaceTransferRouteDeps = {
    embed: async () => new Float32Array([0.5, 0.5, 0.5, 0.5]),
  };
  const registryCount = () => readRegistryFile(files.registryPath).registry.spaces.length;

  it("check reports counts, projects and the model warning, and creates nothing", async () => {
    const before = registryCount();
    const match = await call("/api/spaces/import/check", { document: exportDocument() });
    expect(match!.status).toBe(200);
    expect(data(match).counts).toMatchObject({
      projectMemories: 1,
      userMemories: 1,
      fileProjects: 1,
    });
    expect(data(match).projects).toEqual([`omms_project_${HASH_A}`]);
    expect(data(match).warning).toBeUndefined();
    // The structured pair lets the dialog build its own localised sentence.
    expect(data(match).embedding).toMatchObject({
      fileModel: EMBED_MODEL,
      currentModel: EMBED_MODEL,
    });

    const mismatch = await call("/api/spaces/import/check", {
      document: exportDocument("other-embed"),
    });
    expect(mismatch!.status).toBe(200);
    expect(data(mismatch).warning).toContain("other-embed");
    expect(data(mismatch).warning).toContain(EMBED_MODEL);
    expect(data(mismatch).embedding).toMatchObject({
      fileModel: "other-embed",
      currentModel: EMBED_MODEL,
    });
    expect(registryCount()).toBe(before);
  });

  it("check refuses an invalid document", async () => {
    const result = await call("/api/spaces/import/check", { document: { format: "wrong" } });
    expect(result!.status).toBe(400);
    expect(result!.body).toMatchObject({ success: false, code: "invalid-file" });
  });

  it("imports into a new space and keeps the active space", async () => {
    const activeBefore = readRegistryFile(files.registryPath).registry.activeSpaceId;
    const result = await call(
      "/api/spaces/import",
      { document: exportDocument(), name: "Imported" },
      fakeEmbed
    );
    expect(result!.status).toBe(200);
    expect(data(result)).toMatchObject({ ok: true, spaceName: "Imported" });
    expect(data(result).spaceId).toMatch(/^space-[a-z0-9]{10}$/);
    expect(data(result).counts).toMatchObject({ projectMemories: 1, userMemories: 1 });
    expect((await readRows(join(omms, "spaces", data(result).spaceId))).length).toBe(2);
    expect(readRegistryFile(files.registryPath).registry.activeSpaceId).toBe(activeBefore);
  });

  it("refuses a taken name, a missing retag folder and an invalid file", async () => {
    const before = registryCount();
    const taken = await call(
      "/api/spaces/import",
      { document: exportDocument(), name: "Alpha" },
      fakeEmbed
    );
    expect(taken!.status).toBe(409);
    expect(taken!.body).toMatchObject({ success: false, code: "name-taken" });

    const folder = await call(
      "/api/spaces/import",
      {
        document: exportDocument(),
        name: "Retagged",
        retagToProject: join(project, "no-such-folder"),
      },
      fakeEmbed
    );
    expect(folder!.status).toBe(400);
    expect(folder!.body).toMatchObject({ success: false, code: "missing-folder" });

    const invalid = await call(
      "/api/spaces/import",
      { document: { format: "wrong" }, name: "Never Created" },
      fakeEmbed
    );
    expect(invalid!.status).toBe(400);
    expect(invalid!.body).toMatchObject({ success: false, code: "invalid-file" });
    expect(registryCount()).toBe(before);
  });

  it("refuses a body over the import cap without reading it as a space", async () => {
    const pad = IMPORT_MAX_FILE_BYTES + 65 * 1024;
    const result = await call("/api/spaces/import/check", `{"document":"${"x".repeat(pad)}"}`);
    expect(result!.status).toBe(413);
    expect(result!.body).toMatchObject({ success: false, code: "file-too-large" });
  });
});

describe("links routes", () => {
  beforeAll(async () => {
    await spaceId("Links One");
    await spaceId("Links Two");
    await spaceId("Links Three");
  });

  it("links a space and lists it on the card", async () => {
    const result = await call(`/api/spaces/${spaceIds["Links One"]}/links`, {
      add: spaceIds["Links Two"],
    });
    expect(result!.status).toBe(200);
    expect(data(result).links).toEqual([
      { id: spaceIds["Links Two"], name: "Links Two", available: true },
    ]);

    const listed = await (
      await routeSpaces("/api/spaces", "GET", async () => ({}), project)
    )?.body.data.spaces;
    expect(listed.find((s: any) => s.id === spaceIds["Links One"]).links).toEqual([
      { id: spaceIds["Links Two"], name: "Links Two", available: true },
    ]);
  });

  it("refuses a repeat, a self-link, Default as owner and an unknown space", async () => {
    const repeat = await call(`/api/spaces/${spaceIds["Links One"]}/links`, { add: "Links Two" });
    expect(repeat!.status).toBe(409);
    expect(repeat!.body).toMatchObject({ success: false, code: "name-taken" });

    const self = await call(`/api/spaces/${spaceIds["Links One"]}/links`, {
      add: spaceIds["Links One"],
    });
    expect(self!.status).toBe(409);
    expect(self!.body).toMatchObject({ success: false, code: "protected" });

    const deflt = await call("/api/spaces/default/links", { add: spaceIds["Links One"] });
    expect(deflt!.status).toBe(409);
    expect(deflt!.body).toMatchObject({ success: false, code: "protected" });

    const unknown = await call(`/api/spaces/${spaceIds["Links One"]}/links`, { add: "ghost" });
    expect(unknown!.status).toBe(404);
    expect(unknown!.body).toMatchObject({ success: false, code: "unknown" });

    const unknownOwner = await call("/api/spaces/ghost/links", { add: spaceIds["Links One"] });
    expect(unknownOwner!.status).toBe(404);
  });

  it("marks an archived linked space unavailable, then unlinks it", async () => {
    await archiveStoredSpace(files, spaceIds["Links Two"]!);
    const listed = await (
      await routeSpaces("/api/spaces", "GET", async () => ({}), project)
    )?.body.data.spaces;
    expect(listed.find((s: any) => s.id === spaceIds["Links One"]).links).toEqual([
      { id: spaceIds["Links Two"], name: "Links Two", available: false },
    ]);

    const removed = await call(`/api/spaces/${spaceIds["Links One"]}/links`, {
      remove: spaceIds["Links Two"],
    });
    expect(removed!.status).toBe(200);
    expect(data(removed).links).toEqual([]);

    const missing = await call(`/api/spaces/${spaceIds["Links One"]}/links`, {
      remove: spaceIds["Links Three"],
    });
    expect(missing!.status).toBe(404);
    expect(missing!.body).toMatchObject({ success: false, code: "unknown" });
  });

  it("refuses a body with neither add nor remove", async () => {
    const result = await call(`/api/spaces/${spaceIds["Links One"]}/links`, {});
    expect(result!.status).toBe(400);
    expect(result!.body).toMatchObject({ success: false, code: "invalid" });
  });
});

describe("server rules: auth and body size", () => {
  it("refuses a transfer preview without a token", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/spaces/transfer/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "alpha", to: "beta", ...RANGE }),
    });
    expect(response.status).toBe(401);
  });

  it("accepts a 20 MB body on the import check route", async () => {
    const body = JSON.stringify({ document: "y".repeat(20 * 1024 * 1024) });
    const response = await fetch(`http://127.0.0.1:${port}/api/spaces/import/check`, {
      method: "POST",
      headers: { "x-omms-token": getOrCreateAuthToken(), "content-type": "application/json" },
      body,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid-file");
  });

  it("keeps today's behaviour on non-import routes: no new body limit", async () => {
    const body = JSON.stringify({ pad: "z".repeat(20 * 1024 * 1024) });
    const response = await fetch(`http://127.0.0.1:${port}/api/spaces`, {
      method: "POST",
      headers: { "x-omms-token": getOrCreateAuthToken(), "content-type": "application/json" },
      body,
    });
    // The body arrived and was parsed: the refusal is about the missing name.
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid-name");
  });
});
