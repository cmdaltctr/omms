import { describe, expect, it } from "bun:test";
import { groupOutcomesByHost, groupReasons, percentOf } from "../web/src/lib/diagnostics-groups.js";

const row = (
  host: string,
  provider: string | null,
  model: string | null,
  saved: number,
  skipped: number,
  failed: number
) => ({
  host,
  provider,
  model,
  saved,
  skipped,
  failed,
  total: saved + skipped + failed,
});

describe("groupOutcomesByHost", () => {
  const rows = [
    row("pi", null, null, 10, 1, 2),
    row("opencode", "zai", "glm-5-turbo", 4, 0, 0),
    row("claude-code", "openai-chat", "glm-5-turbo", 5, 1, 1),
    row("pi", "zai", "glm-5-turbo", 20, 1, 0),
    row("opencode", null, null, 100, 5, 1),
    row("pi", "zai", "glm-5.3", 1, 0, 0),
  ];

  it("gives one row per host in a fixed order with summed totals", () => {
    const hosts = groupOutcomesByHost(rows);
    expect(hosts.map((h) => [h.host, h.saved, h.skipped, h.failed, h.total])).toEqual([
      ["opencode", 104, 5, 1, 110],
      ["pi", 31, 2, 2, 35],
      ["claude-code", 5, 1, 1, 7],
    ]);
  });

  it("lists each host's models largest first, with null for no recorded model", () => {
    const pi = groupOutcomesByHost(rows).find((h) => h.host === "pi")!;
    expect(pi.models.map((m) => [m.label, m.total])).toEqual([
      ["zai/glm-5-turbo", 21],
      [null, 13],
      ["zai/glm-5.3", 1],
    ]);
  });

  it("computes percentages of the row total and never divides by zero", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("groupReasons", () => {
  it("sums the same host and reason across models", () => {
    expect(
      groupReasons([
        { host: "claude-code", reason: "call-error", count: 31 },
        { host: "pi", reason: "persist-error", count: 8 },
        { host: "claude-code", reason: "call-error", count: 6 },
      ])
    ).toEqual([
      { host: "claude-code", reason: "call-error", count: 37 },
      { host: "pi", reason: "persist-error", count: 8 },
    ]);
  });
});
