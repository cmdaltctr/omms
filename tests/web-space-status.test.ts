import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig } from "../src/config.js";
import { getOrCreateAuthToken } from "../src/services/auth-token.js";
import {
  createStoredSpace,
  spaceFiles,
  switchStoredSpace,
} from "../src/services/spaces/registry-store.js";
import { WebServer } from "../src/services/web-server.js";

const omms = join(homedir(), ".omms");
const files = spaceFiles(omms);
const port = 49100 + (process.pid % 500);
let project: string;
let server: WebServer;

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { "x-omms-token": getOrCreateAuthToken(), "content-type": "application/json" },
  });
  return { status: response.status, body: (await response.json()) as any };
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "omms-web-status-"));
  initConfig(project);
  server = new WebServer({ enabled: true, host: "127.0.0.1", port, directory: project } as never);
  await server.start();
});
afterAll(async () => {
  await server.stop();
  rmSync(files.registryPath, { force: true });
  rmSync(files.spacesRoot, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  initConfig("/nonexistent-project");
});

describe("web server space support", () => {
  it("reports the active space in the status call", async () => {
    const { body } = await api("/api/web/status");
    expect(body.activeSpace).toEqual({ id: "default", name: "Default", customStoragePath: false });
  });

  it("shows a switch made outside the web app on the next status call", async () => {
    const space = await createStoredSpace(files, "Aizat");
    await switchStoredSpace(files, space.id);
    const { body } = await api("/api/web/status");
    expect(body.activeSpace).toMatchObject({ id: "aizat", name: "Aizat" });
  });

  it("serves the spaces API behind the same token", async () => {
    const listed = await api("/api/spaces");
    expect(listed.status).toBe(200);
    expect(listed.body.data.activeSpaceId).toBe("aizat");
    const denied = await fetch(`http://127.0.0.1:${port}/api/spaces`);
    expect(denied.status).toBe(401);
  });

  it("serves the Spaces page route as the app shell", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/spaces`);
    expect(response.status).not.toBe(404);
  });
});
