import { expect, it } from "bun:test";
import { initialImportDraft } from "../src/lib/components/memory/import-draft";
import {
  defaultImportModel,
  importModelLine,
} from "../src/lib/components/memory/import-model-blocker";
import type { Readiness } from "../src/lib/components/memory/import-types";

function readiness(models: { provider: string; model: string; name: string }[] = []): Readiness {
  return {
    external: { state: "ready", provider: "deepseek", model: "deepseek-flash" },
    opencode: { available: true, models },
    piReader: { available: true },
  };
}
const LISTED = { provider: "anthropic", model: "claude-sonnet", name: "Claude Sonnet" };

it("always picks the external API for Claude Code", () => {
  const ready = readiness([LISTED]);
  expect(defaultImportModel("claude-code", "anthropic/claude-sonnet", ready)).toBe("external");
  expect(defaultImportModel("claude-code", "inherit", ready)).toBe("external");
});

it("uses a Pi backfill model that the connected OpenCode lists", () => {
  expect(defaultImportModel("pi", "anthropic/claude-sonnet", readiness([LISTED]))).toBe(
    "anthropic/claude-sonnet"
  );
  expect(defaultImportModel("opencode", "anthropic/claude-sonnet", readiness([LISTED]))).toBe(
    "anthropic/claude-sonnet"
  );
});

it("falls back to the external API for inherit, external, an unlisted model or no readiness", () => {
  const ready = readiness([LISTED]);
  expect(defaultImportModel("pi", "inherit", ready)).toBe("external");
  expect(defaultImportModel("pi", "external", ready)).toBe("external");
  expect(defaultImportModel("pi", "other/unlisted", ready)).toBe("external");
  expect(defaultImportModel("pi", null, ready)).toBe("external");
  expect(defaultImportModel("pi", "anthropic/claude-sonnet", null)).toBe("external");
});

function draftFor(choices: Partial<Record<"pi" | "opencode" | "claude-code", string>>) {
  const draft = initialImportDraft();
  for (const [host, choice] of Object.entries(choices))
    draft.hosts[host as "pi"].modelChoice = choice;
  return draft;
}

it("names the saved external API once when both imports use it", () => {
  const line = importModelLine(["pi"], draftFor({ pi: "external" }), readiness(), {
    pi: "external",
  });
  expect(line.models).toEqual([
    { text: "Saved external API ({model})", params: { model: "deepseek/deepseek-flash" } },
  ]);
  expect(line.notes).toEqual([]);
});

it("names a listed connected model by its name", () => {
  const line = importModelLine(
    ["pi"],
    draftFor({ pi: "anthropic/claude-sonnet" }),
    readiness([LISTED]),
    { pi: "anthropic/claude-sonnet" }
  );
  expect(line.models).toEqual([{ text: "{model}", params: { model: "Claude Sonnet" } }]);
  expect(line.notes).toEqual([]);
});

it("names a second model when the backfill model differs", () => {
  const line = importModelLine(["pi"], draftFor({ pi: "external" }), readiness(), {
    pi: "openrouter/some-model",
  });
  expect(line.notes).toEqual([
    {
      text: "Automatic import for {host} uses {model}. Change it in the {host} settings card further down the page.",
      params: { host: "Pi", model: "openrouter/some-model" },
    },
  ]);
});

it("says inherit uses the open host session, and names the external API when the import model differs", () => {
  const inherit = importModelLine(["opencode"], draftFor({ opencode: "external" }), readiness(), {
    opencode: "inherit",
  });
  expect(inherit.notes).toEqual([
    {
      text: "Automatic import for {host} uses the model of your open {host} session. Change it in the {host} settings card further down the page.",
      params: { host: "OpenCode" },
    },
  ]);
  const external = importModelLine(
    ["pi"],
    draftFor({ pi: "anthropic/claude-sonnet" }),
    readiness([LISTED]),
    { pi: "external" }
  );
  expect(external.notes).toEqual([
    {
      text: "Automatic import for {host} uses {model}. Change it in the {host} settings card further down the page.",
      params: { host: "Pi", model: "deepseek/deepseek-flash" },
    },
  ]);
});

it("adds no note for Claude Code or for a backfill model that is not loaded yet", () => {
  const code = importModelLine(
    ["claude-code"],
    draftFor({ "claude-code": "external" }),
    readiness(),
    {}
  );
  expect(code.notes).toEqual([]);
  const unloaded = importModelLine(["pi"], draftFor({ pi: "external" }), readiness(), {});
  expect(unloaded.notes).toEqual([]);
});

it("lists each distinct import model once across hosts", () => {
  const line = importModelLine(
    ["pi", "opencode", "claude-code"],
    draftFor({ pi: "anthropic/claude-sonnet", opencode: "external", "claude-code": "external" }),
    readiness([LISTED]),
    {}
  );
  expect(line.models).toEqual([
    { text: "{model}", params: { model: "Claude Sonnet" } },
    { text: "Saved external API ({model})", params: { model: "deepseek/deepseek-flash" } },
  ]);
});
