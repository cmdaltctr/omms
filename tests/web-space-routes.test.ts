import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, initConfig } from "../src/config.js";
import { routeSpaces } from "../src/services/space-routes.js";

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

type Result = { status: number; body: any } | undefined;
const call = async (method: string, path: string, body: Record<string, unknown> = {}) =>
  (await routeSpaces(path, method, async () => body, project)) as Result;
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
      disabled: { archive: "default", delete: "default", rename: "default" },
    });
    expect(typeof listed.spaces[0].sizeBytes).toBe("number");
  });

  it("creates a space and refuses a duplicate name", async () => {
    const created = await call("POST", "/api/spaces", { name: "Client work" });
    expect(created!.status).toBe(200);
    expect(data(created).space.id).toBe("client-work");
    const again = await call("POST", "/api/spaces", { name: "client WORK" });
    expect(again!.status).toBe(409);
    expect(again!.body).toMatchObject({ success: false, code: "name-taken" });
    expect((await call("POST", "/api/spaces", { name: " " }))!.status).toBe(400);
  });

  it("switches, and the web app follows at once", async () => {
    const switched = await call("POST", "/api/spaces/client-work/switch");
    expect(switched!.status).toBe(200);
    expect(CONFIG.storagePath).toBe(join(omms, "spaces", "client-work"));
    const listed = data(await call("GET", "/api/spaces"));
    expect(listed.activeSpaceId).toBe("client-work");
    const active = listed.spaces.find((s: any) => s.id === "client-work");
    expect(active.disabled).toMatchObject({ archive: "active", delete: "active" });
  });

  it("refuses to switch to an archived or unknown space", async () => {
    await call("POST", "/api/spaces", { name: "Old" });
    await call("POST", "/api/spaces/old/archive");
    expect((await call("POST", "/api/spaces/old/switch"))!.status).toBe(409);
    expect((await call("POST", "/api/spaces/ghost/switch"))!.status).toBe(404);
    expect((await call("POST", "/api/spaces/old/unarchive"))!.status).toBe(200);
  });

  it("reports when a space was archived and nothing for one that is not", async () => {
    await call("POST", "/api/spaces", { name: "Dated" });
    await call("POST", "/api/spaces/dated/archive");
    const rows = data(await call("GET", "/api/spaces")).spaces;
    const dated = rows.find((s: any) => s.id === "dated");
    expect(dated.archived).toBe(true);
    expect(Number.isNaN(Date.parse(dated.archivedAt))).toBe(false);
    expect(rows.find((s: any) => s.id === "default").archivedAt).toBeNull();
    await call("POST", "/api/spaces/dated/unarchive");
    expect(
      data(await call("GET", "/api/spaces")).spaces.find((s: any) => s.id === "dated").archivedAt
    ).toBeNull();
  });

  it("refuses to archive the active space", async () => {
    const result = await call("POST", "/api/spaces/client-work/archive");
    expect(result!.status).toBe(409);
    expect(result!.body.code).toBe("active");
  });

  it("renames a space and keeps its folder", async () => {
    const renamed = await call("POST", "/api/spaces/old/rename", { name: "Older" });
    expect(renamed!.status).toBe(200);
    const listed = data(await call("GET", "/api/spaces"));
    expect(listed.spaces.find((s: any) => s.id === "old").name).toBe("Older");
    expect(existsSync(join(omms, "spaces", "old"))).toBe(true);
  });

  it("backs up a space, lists the backup and restores it as a new space", async () => {
    writeFileSync(join(omms, "spaces", "old", "cold-buffer.json"), '{"a":1}');
    const backup = await call("POST", "/api/spaces/old/backup");
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
    expect((await call("DELETE", "/api/spaces/old", { confirmName: "nope" }))!.status).toBe(400);
    expect(existsSync(join(omms, "spaces", "old"))).toBe(true);
    expect((await call("DELETE", "/api/spaces/default", { confirmName: "Default" }))!.status).toBe(
      409
    );
    expect(
      (await call("DELETE", "/api/spaces/client-work", { confirmName: "Client work" }))!.status
    ).toBe(409);
  });

  it("deletes after a verified backup and returns the backup location", async () => {
    const before = readdirSync(join(omms, "backups")).length;
    const result = await call("DELETE", "/api/spaces/old", { confirmName: "Older" });
    expect(result!.status).toBe(200);
    expect(data(result).backup.folder).toMatch(/^space-old-/);
    expect(existsSync(join(omms, "spaces", "old"))).toBe(false);
    expect(readdirSync(join(omms, "backups")).length).toBe(before + 1);
  });
});

describe("space icons", () => {
  const looks = async () =>
    Object.fromEntries(
      data(await call("GET", "/api/spaces")).spaces.map((s: any) => [s.id, s.look])
    );

  it("lists every space with a default look first", async () => {
    await call("POST", "/api/spaces", { name: "Icon space" });
    expect((await looks())["icon-space"]).toEqual({ kind: "default" });
    expect((await looks()).default).toEqual({ kind: "default" });
  });

  it("saves an icon, then an image, then resets to the default", async () => {
    const icon = await call("PUT", "/api/spaces/icon-space/appearance", {
      kind: "icon",
      icon: "boxes",
    });
    expect(icon!.status).toBe(200);
    expect((await looks())["icon-space"]).toEqual({ kind: "icon", icon: "boxes" });
    const png = pngBase64();
    expect(
      (await call("PUT", "/api/spaces/icon-space/appearance", { kind: "image", png }))!.status
    ).toBe(200);
    expect((await looks())["icon-space"]).toEqual({
      kind: "image",
      image: `data:image/png;base64,${png}`,
    });
    expect((await call("DELETE", "/api/spaces/icon-space/appearance"))!.status).toBe(200);
    expect((await looks())["icon-space"]).toEqual({ kind: "default" });
  });

  it("keeps the icons outside every space folder, so a switch never hides them", async () => {
    await call("PUT", "/api/spaces/default/appearance", { kind: "icon", icon: "cat" });
    expect(existsSync(join(omms, "space-appearance", "appearance.json"))).toBe(true);
    expect(existsSync(join(omms, "spaces", "icon-space", "appearance.json"))).toBe(false);
    await call("POST", "/api/spaces/icon-space/switch");
    expect((await looks()).default).toEqual({ kind: "icon", icon: "cat" });
    await call("POST", "/api/spaces/default/switch");
  });

  it("refuses a bad icon name, a wrong image and an unknown space", async () => {
    expect(
      (await call("PUT", "/api/spaces/icon-space/appearance", { kind: "icon", icon: "../x" }))!
        .status
    ).toBe(400);
    expect(
      (await call("PUT", "/api/spaces/icon-space/appearance", {
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
    await call("POST", "/api/spaces", { name: "Gone soon" });
    await call("PUT", "/api/spaces/gone-soon/appearance", { kind: "icon", icon: "bot" });
    const removed = await call("DELETE", "/api/spaces/gone-soon", { confirmName: "Gone soon" });
    expect(removed!.status).toBe(200);
    expect(existsSync(join(omms, "space-appearance", "gone-soon.png"))).toBe(false);
    const saved = JSON.parse(
      readFileSync(join(omms, "space-appearance", "appearance.json"), "utf8")
    );
    expect(saved["gone-soon"]).toBeUndefined();
  });
});
