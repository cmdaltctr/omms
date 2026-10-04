import { expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const visualRoot = join(import.meta.dir, "visual");

async function fixtureResponse(method: string, url: string, body?: unknown) {
  const fixtures = await import("./visual/fixtures.ts");
  return fixtures.fixtureResponse(method, url, body);
}

it("serves declared synthetic reads without a backend dependency", async () => {
  await expect(fixtureResponse("GET", "/api/health")).resolves.toMatchObject({
    status: 200,
    body: expect.any(Object),
  });
});

it("fails unknown API routes closed and rejects undeclared mutations", async () => {
  await expect(fixtureResponse("GET", "/api/not-declared")).resolves.toEqual({
    status: 404,
    body: expect.any(Object),
  });
  await expect(fixtureResponse("POST", "/api/health", { unwanted: true })).resolves.toEqual({
    status: 405,
    body: expect.any(Object),
  });
});

it("keeps declared memory and settings mutations in synthetic fixture memory", async () => {
  const originalMemory = await fixtureResponse("GET", "/api/memories");
  const originalContent = (
    originalMemory.body as { data: { items: Array<{ id: string; content: string }> } }
  ).data.items.find((memory) => memory.id === "preview-memory-1")!.content;
  const originalSettings = await fixtureResponse("GET", "/api/settings");
  const originalModel = (
    originalSettings.body as { settings: { opencodeModel: { value: string } } }
  ).settings.opencodeModel.value;

  try {
    await expect(
      fixtureResponse("PUT", "/api/memories/preview-memory-1", { content: "Synthetic saved draft" })
    ).resolves.toMatchObject({
      status: 200,
      body: { success: true, data: { content: "Synthetic saved draft" } },
    });
    await expect(
      fixtureResponse("PATCH", "/api/settings", { edits: { opencodeModel: "saved-preview-model" } })
    ).resolves.toEqual({
      status: 200,
      body: { migratedLegacy: false },
    });

    const memories = await fixtureResponse("GET", "/api/memories");
    const settings = await fixtureResponse("GET", "/api/settings");
    expect(
      (
        memories.body as {
          success: boolean;
          data: { items: Array<{ id: string; content: string }> };
        }
      ).success
    ).toBe(true);
    expect(
      (memories.body as { data: { items: Array<{ id: string; content: string }> } }).data.items
    ).toContainEqual(
      expect.objectContaining({ id: "preview-memory-1", content: "Synthetic saved draft" })
    );
    expect(settings.body).not.toHaveProperty("success");
    expect(
      (settings.body as { settings: { opencodeModel: { value: string } } }).settings.opencodeModel
        .value
    ).toBe("saved-preview-model");
  } finally {
    await fixtureResponse("PUT", "/api/memories/preview-memory-1", { content: originalContent });
    await fixtureResponse("PATCH", "/api/settings", { edits: { opencodeModel: originalModel } });
  }
});

it("uses fixture middleware for both Vite server modes with no live API proxy", () => {
  const configPath = join(visualRoot, "vite.config.ts");
  expect(existsSync(configPath)).toBe(true);
  const config = readFileSync(configPath, "utf8");

  expect(config).toContain("configureServer");
  expect(config).toContain("configurePreviewServer");
  expect(config).toMatch(/server:\s*\{\s*proxy:\s*\{\s*\}/);
  expect(config).toMatch(/preview:\s*\{\s*proxy:\s*\{\s*\}/);
  expect(config).not.toContain("4747");
  expect(config).toContain("fixtureResponse");
});
