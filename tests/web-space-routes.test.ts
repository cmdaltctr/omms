import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, initConfig } from "../src/config.js";
import { routeSpaces, type SpaceRouteOptions } from "../src/services/space-routes.js";

function pngBase64(width = 128, height = 128): string {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write("IHDR", 4, "ascii");
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  header.set([8, 6, 0, 0, 0], 16);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    header,
    Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]).toString("base64");
}

const omms = join(homedir(), ".omms");
let project: string;
/** Random ids of the spaces the earlier tests create; the tests share one registry. */
let clientWorkId: string;
let oldId: string;
let iconSpaceId: string;

type Result = { status: number; body: any } | undefined;
const call = async (method: string, path: string, body: Record<string, unknown> = {}) =>
  (await routeSpaces(path, method, async () => body, project)) as Result;
const callFrom = async (
  method: string,
  path: string,
  options: SpaceRouteOptions,
  body: Record<string, unknown> = {}
) => (await routeSpaces(path, method, async () => body, project, options)) as Result;
const data = (result: Result) => result!.body.data;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-web-spaces-"));
  initConfig(project);
});
afterAll(() => {
  rmSync(join(omms, "spaces.json"), { force: true });
  rmSync(join(omms, "spaces"), { recursive: true, force: true });
  rmSync(join(omms, "backups"), { recursive: true, force: true });
  rmSync(join(omms, "space-appearance"), { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

describe("space routes", () => {
  it("ignores paths it does not own", async () => {
    expect(await call("GET", "/api/memories")).toBeUndefined();
  });

  it("lists Default as the active space, with reasons for blocked actions", async () => {
    const result = await call("GET", "/api/spaces");
    expect(result!.status).toBe(200);
    const listed = data(result);
    expect(listed.activeSpaceId).toBe("default");
    expect(listed.spaces).toHaveLength(1);
    expect(listed.spaces[0]).toMatchObject({
      id: "default",
      name: "Default",
      active: true,
      disabled: { archive: "default", delete: "default" },
    });
    expect(listed.spaces[0].disabled.rename).toBeUndefined();
    expect(typeof listed.spaces[0].sizeBytes).toBe("number");
  });

  it("creates a space and refuses a duplicate name", async () => {
    const created = await call("POST", "/api/spaces", { name: "Client work" });
    expect(created!.status).toBe(200);
    clientWorkId = data(created).space.id;
    expect(clientWorkId).toMatch(/^space-[a-z0-9]{10}$/);
    const again = await call("POST", "/api/spaces", { name: "client WORK" });
    expect(again!.status).toBe(409);
    expect(again!.body).toMatchObject({ success: false, code: "name-taken" });
    expect((await call("POST", "/api/spaces", { name: " " }))!.status).toBe(400);
  });

  it("switches, and the web app follows at once", async () => {
    const switched = await call("POST", `/api/spaces/${clientWorkId}/switch`);
    expect(switched!.status).toBe(200);
    expect(CONFIG.storagePath).toBe(join(omms, "spaces", clientWorkId));
    const listed = data(await call("GET", "/api/spaces"));
    expect(listed.activeSpaceId).toBe(clientWorkId);
    const active = listed.spaces.find((s: any) => s.id === clientWorkId);
    expect(active.disabled).toMatchObject({ archive: "active", delete: "active" });
  });

  it("refuses to switch to an archived or unknown space", async () => {
    oldId = data(await call("POST", "/api/spaces", { name: "Old" })).space.id;
    await call("POST", `/api/spaces/${oldId}/archive`);
    expect((await call("POST", `/api/spaces/${oldId}/switch`))!.status).toBe(409);
    expect((await call("POST", "/api/spaces/ghost/switch"))!.status).toBe(404);
    expect((await call("POST", `/api/spaces/${oldId}/unarchive`))!.status).toBe(200);
  });

  it("reports when a space was archived and nothing for one that is not", async () => {
    const datedId = data(await call("POST", "/api/spaces", { name: "Dated" })).space.id;
    await call("POST", `/api/spaces/${datedId}/archive`);
    const rows = data(await call("GET", "/api/spaces")).spaces;
    const dated = rows.find((s: any) => s.id === datedId);
    expect(dated.archived).toBe(true);
    expect(Number.isNaN(Date.parse(dated.archivedAt))).toBe(false);
    expect(rows.find((s: any) => s.id === "default").archivedAt).toBeNull();
    await call("POST", `/api/spaces/${datedId}/unarchive`);
    expect(
      data(await call("GET", "/api/spaces")).spaces.find((s: any) => s.id === datedId).archivedAt
    ).toBeNull();
  });

  it("refuses to archive the active space", async () => {
    const result = await call("POST", `/api/spaces/${clientWorkId}/archive`);
    expect(result!.status).toBe(409);
    expect(result!.body.code).toBe("active");
  });

  it("renames a space and keeps its folder", async () => {
    const renamed = await call("POST", `/api/spaces/${oldId}/rename`, { name: "Older" });
    expect(renamed!.status).toBe(200);
    const listed = data(await call("GET", "/api/spaces"));
    expect(listed.spaces.find((s: any) => s.id === oldId).name).toBe("Older");
    expect(existsSync(join(omms, "spaces", oldId))).toBe(true);
  });

  it("renames the Default space and keeps its id", async () => {
    const renamed = await call("POST", "/api/spaces/default/rename", { name: "Main" });
    expect(renamed!.status).toBe(200);
    const row = data(await call("GET", "/api/spaces")).spaces.find((s: any) => s.id === "default");
    expect(row.name).toBe("Main");
  });

  it("backs up a space, lists the backup and restores it as a new space", async () => {
    writeFileSync(join(omms, "spaces", oldId, "cold-buffer.json"), '{"a":1}');
    const backup = await call("POST", `/api/spaces/${oldId}/backup`);
    expect(backup!.status).toBe(200);
    expect(data(backup).backup.spaceName).toBe("Older");
    const listed = data(await call("GET", "/api/spaces"));
    expect(listed.backups).toHaveLength(1);
    const restored = await call("POST", "/api/spaces/backups/restore", {
      backup: listed.backups[0].folder,
    });
    expect(restored!.status).toBe(200);
    expect(data(restored).space.name).toMatch(/^Older \(restored \d{4}-\d{2}-\d{2}\)$/);
    expect((await call("GET", "/api/spaces")) && true).toBe(true);
  });

  it("refuses a restore for a folder that is not a listed backup", async () => {
    const result = await call("POST", "/api/spaces/backups/restore", { backup: "../../etc" });
    expect(result!.status).toBe(404);
    expect(result!.body.code).toBe("unknown-backup");
  });

  it("does not delete without the typed name, and refuses Default and the active space", async () => {
    expect((await call("DELETE", `/api/spaces/${oldId}`, { confirmName: "nope" }))!.status).toBe(
      400
    );
    expect(existsSync(join(omms, "spaces", oldId))).toBe(true);
    expect((await call("DELETE", "/api/spaces/default", { confirmName: "Default" }))!.status).toBe(
      409
    );
    expect(
      (await call("DELETE", `/api/spaces/${clientWorkId}`, { confirmName: "Client work" }))!.status
    ).toBe(409);
  });

  it("deletes after a verified backup and returns the backup location", async () => {
    const before = readdirSync(join(omms, "backups")).length;
    const result = await call("DELETE", `/api/spaces/${oldId}`, { confirmName: "Older" });
    expect(result!.status).toBe(200);
    expect(data(result).backup.folder).toMatch(new RegExp(`^space-${oldId}-`));
    expect(existsSync(join(omms, "spaces", oldId))).toBe(false);
    expect(readdirSync(join(omms, "backups")).length).toBe(before + 1);
  });
});

describe("space icons", () => {
  const looks = async () =>
    Object.fromEntries(
      data(await call("GET", "/api/spaces")).spaces.map((s: any) => [s.id, s.look])
    );

  it("lists every space with a default look first", async () => {
    iconSpaceId = data(await call("POST", "/api/spaces", { name: "Icon space" })).space.id;
    expect((await looks())[iconSpaceId]).toEqual({ kind: "default" });
    expect((await looks()).default).toEqual({ kind: "default" });
  });

  it("saves an icon, then an image, then resets to the default", async () => {
    const icon = await call("PUT", `/api/spaces/${iconSpaceId}/appearance`, {
      kind: "icon",
      icon: "boxes",
    });
    expect(icon!.status).toBe(200);
    expect((await looks())[iconSpaceId]).toEqual({ kind: "icon", icon: "boxes" });
    const png = pngBase64();
    expect(
      (await call("PUT", `/api/spaces/${iconSpaceId}/appearance`, { kind: "image", png }))!.status
    ).toBe(200);
    expect((await looks())[iconSpaceId]).toEqual({
      kind: "image",
      image: `data:image/png;base64,${png}`,
    });
    expect((await call("DELETE", `/api/spaces/${iconSpaceId}/appearance`))!.status).toBe(200);
    expect((await looks())[iconSpaceId]).toEqual({ kind: "default" });
  });

  it("keeps the icons outside every space folder, so a switch never hides them", async () => {
    await call("PUT", "/api/spaces/default/appearance", { kind: "icon", icon: "cat" });
    expect(existsSync(join(omms, "space-appearance", "appearance.json"))).toBe(true);
    expect(existsSync(join(omms, "spaces", iconSpaceId, "appearance.json"))).toBe(false);
    await call("POST", `/api/spaces/${iconSpaceId}/switch`);
    expect((await looks()).default).toEqual({ kind: "icon", icon: "cat" });
    await call("POST", "/api/spaces/default/switch");
  });

  it("refuses a bad icon name, a wrong image and an unknown space", async () => {
    expect(
      (await call("PUT", `/api/spaces/${iconSpaceId}/appearance`, { kind: "icon", icon: "../x" }))!
        .status
    ).toBe(400);
    expect(
      (await call("PUT", `/api/spaces/${iconSpaceId}/appearance`, {
        kind: "image",
        png: pngBase64(64, 64),
      }))!.status
    ).toBe(400);
    expect(
      (await call("PUT", "/api/spaces/ghost/appearance", { kind: "icon", icon: "boxes" }))!.status
    ).toBe(404);
    expect((await call("DELETE", "/api/spaces/ghost/appearance"))!.status).toBe(404);
  });

  it("removes the icon of a deleted space", async () => {
    const goneSoonId = data(await call("POST", "/api/spaces", { name: "Gone soon" })).space.id;
    await call("PUT", `/api/spaces/${goneSoonId}/appearance`, { kind: "icon", icon: "bot" });
    const removed = await call("DELETE", `/api/spaces/${goneSoonId}`, { confirmName: "Gone soon" });
    expect(removed!.status).toBe(200);
    expect(existsSync(join(omms, "space-appearance", `${goneSoonId}.png`))).toBe(false);
    const saved = JSON.parse(
      readFileSync(join(omms, "space-appearance", "appearance.json"), "utf8")
    );
    expect(saved[goneSoonId]).toBeUndefined();
  });
});

describe("open folder", () => {
  /** The file manager command the route must start on this platform. */
  const expectedOpener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";

  /** Records what the route asked to start, so a test never opens a real file manager. */
  function recordingOpener(failure?: Error) {
    const calls: { command: string; args: string[] }[] = [];
    const start = async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (failure) throw failure;
    };
    return { calls, start };
  }

  it("opens the folder of a known space for a loopback caller", async () => {
    const openId = data(await call("POST", "/api/spaces", { name: "Folder target" })).space.id;
    const folder = join(omms, "spaces", openId);
    const opener = recordingOpener();
    const result = await callFrom("POST", `/api/spaces/${openId}/open-folder`, {
      remoteAddress: "127.0.0.1",
      startOpener: opener.start,
    });
    expect(result!.status).toBe(200);
    expect(data(result).folder).toBe(folder);
    expect(opener.calls).toEqual([{ command: expectedOpener, args: [folder] }]);
  });

  it("refuses a caller from another machine and starts nothing", async () => {
    const openId = data(await call("GET", "/api/spaces")).spaces.find(
      (s: any) => s.name === "Folder target"
    ).id;
    const opener = recordingOpener();
    const result = await callFrom("POST", `/api/spaces/${openId}/open-folder`, {
      remoteAddress: "192.168.1.5",
      startOpener: opener.start,
    });
    expect(result!.status).toBe(403);
    expect(result!.body).toMatchObject({ success: false, code: "forbidden" });
    expect(result!.body.error).toMatch(/local machine/);
    expect(opener.calls).toEqual([]);
  });

  it("refuses an unknown space id", async () => {
    const opener = recordingOpener();
    const result = await callFrom("POST", "/api/spaces/ghost/open-folder", {
      remoteAddress: "::1",
      startOpener: opener.start,
    });
    expect(result!.status).toBe(404);
    expect(result!.body.code).toBe("unknown");
    expect(opener.calls).toEqual([]);
  });

  it("reports a folder that is missing on disk and starts nothing", async () => {
    const goneId = data(await call("POST", "/api/spaces", { name: "Gone folder" })).space.id;
    const folder = join(omms, "spaces", goneId);
    rmSync(folder, { recursive: true, force: true });
    const opener = recordingOpener();
    const result = await callFrom("POST", `/api/spaces/${goneId}/open-folder`, {
      remoteAddress: "127.0.0.1",
      startOpener: opener.start,
    });
    expect(result!.status).toBe(409);
    expect(result!.body.code).toBe("missing-folder");
    expect(result!.body.error).toContain(folder);
    expect(opener.calls).toEqual([]);
  });

  it("reports a failed opener", async () => {
    const openId = data(await call("GET", "/api/spaces")).spaces.find(
      (s: any) => s.name === "Folder target"
    ).id;
    const opener = recordingOpener(new Error("spawn xdg-open ENOENT"));
    const result = await callFrom("POST", `/api/spaces/${openId}/open-folder`, {
      remoteAddress: "127.0.0.1",
      startOpener: opener.start,
    });
    expect(result!.status).toBe(500);
    expect(result!.body.code).toBe("opener");
  });

  it("lists the folder of every space, Default's being the global one", async () => {
    const listed = data(await call("GET", "/api/spaces"));
    expect(listed.spaces.length).toBeGreaterThan(1);
    for (const space of listed.spaces) expect(typeof space.folder).toBe("string");
    expect(listed.spaces.find((s: any) => s.id === "default").folder).toBe(
      CONFIG.skillStoragePath ?? CONFIG.storagePath
    );
    const target = listed.spaces.find((s: any) => s.name === "Folder target");
    expect(target.folder).toBe(join(omms, "spaces", target.id));
  });
});
