import { afterEach, expect, it, mock } from "bun:test";

const warnings: string[] = [];
mock.module("sonner", () => ({
  toast: {
    warning: (message: string) => warnings.push(message),
    success: () => {},
    error: () => {},
  },
}));

// settingsRequest reads the page token from window.
(globalThis as { window?: unknown }).window ??= {};

const { reloadSettingsSnapshot } = await import("../src/lib/settings-api");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  warnings.length = 0;
});

it("warns once when the settings reload fails, so the next save is not a silent conflict", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;

  expect(await reloadSettingsSnapshot()).toBeNull();
  expect(warnings).toEqual([
    "Could not load the latest settings. Reload the page before you save again.",
  ]);
});

it("does not warn when the reload succeeds", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ revision: "rev-1" }), {
      status: 200,
    })) as unknown as typeof fetch;

  expect(await reloadSettingsSnapshot()).toEqual({ revision: "rev-1" });
  expect(warnings).toEqual([]);
});
