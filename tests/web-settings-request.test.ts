import { afterEach, expect, it } from "bun:test";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("sends the JSON content type on a body-less DELETE, which the server requires", async () => {
  const seen: Array<{ method: string; headers: Record<string, string> }> = [];
  Object.assign(globalThis, { window: { __OMMS_TOKEN__: "t" } });
  globalThis.fetch = (async (_path: string, init: RequestInit) => {
    seen.push({ method: init.method ?? "GET", headers: init.headers as Record<string, string> });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const { settingsRequest } = await import("../web/src/lib/settings-api.js");
  await settingsRequest("/api/settings/traces/capture-2026-09-27.jsonl", { method: "DELETE" });
  await settingsRequest("/api/settings");
  expect(seen[0]!.headers["Content-Type"]).toBe("application/json");
  expect(seen[1]!.headers["Content-Type"]).toBeUndefined();
});

it("gives every section the latest revision after another section saves", async () => {
  const { onSettingsSnapshot, publishSettingsSnapshot } =
    await import("../web/src/lib/settings-api.js");
  const models: string[] = [];
  const diagnostics: string[] = [];
  const stopModels = onSettingsSnapshot((value) =>
    models.push((value as { revision: string }).revision)
  );
  const stopDiagnostics = onSettingsSnapshot((value) =>
    diagnostics.push((value as { revision: string }).revision)
  );
  publishSettingsSnapshot({ revision: "after-model-save" });
  stopModels();
  publishSettingsSnapshot({ revision: "after-trace-save" });
  stopDiagnostics();
  expect(models).toEqual(["after-model-save"]);
  expect(diagnostics).toEqual(["after-model-save", "after-trace-save"]);
});

it("joins a server message and a note with one full stop", async () => {
  const { withNote } = await import("../web/src/lib/settings-api.js");
  expect(withNote("Config changed. Reload settings and save again.", "Check the values.")).toBe(
    "Config changed. Reload settings and save again. Check the values."
  );
  expect(withNote("Invalid value", "Check the values.")).toBe("Invalid value. Check the values.");
});
