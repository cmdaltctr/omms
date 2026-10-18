import { describe, expect, it } from "bun:test";
import { createWriteHealth } from "../src/services/write-health.js";

function deps(overrides: { store?: () => Promise<void>; embed?: () => Promise<number> } = {}) {
  const calls = { store: 0, embed: 0 };
  let clock = 1_000;
  return {
    calls,
    advance: (ms: number) => (clock += ms),
    options: {
      openStore: async () => {
        calls.store++;
        await overrides.store?.();
      },
      embed: async () => {
        calls.embed++;
        return overrides.embed ? overrides.embed() : 1024;
      },
      secrets: () => ["sk-secret-key"],
      now: () => clock,
    },
  };
}

describe("write health", () => {
  it("passes when the store opens and the test string embeds", async () => {
    const d = deps();
    const result = await createWriteHealth(d.options).check();
    expect(result).toEqual({ ok: true, reason: null, checkedAt: 1_000 });
  });

  it("names an embedding server error with its HTTP status", async () => {
    const d = deps({
      embed: async () => {
        throw new Error("API embedding failed: 500 Internal Server Error");
      },
    });
    const result = await createWriteHealth(d.options).check();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Embedding server error (500)");
  });

  it("reports a store that cannot be opened and skips the embedding call", async () => {
    const d = deps({
      store: async () => {
        throw new Error("unable to open database file");
      },
    });
    const result = await createWriteHealth(d.options).check();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Memory store cannot be opened");
    expect(d.calls.embed).toBe(0);
  });

  it("keeps the reason on one short line and removes secrets", async () => {
    const d = deps({
      embed: async () => {
        throw new Error(
          "fetch failed\nBearer sk-secret-key rejected sk-secret-key " + "x".repeat(400)
        );
      },
    });
    const result = await createWriteHealth(d.options).check();
    expect(result.ok).toBe(false);
    expect(result.reason).not.toContain("sk-secret-key");
    expect(result.reason).not.toContain("\n");
    expect(result.reason!.length).toBeLessThanOrEqual(140);
  });

  it("reuses a result for 30 seconds, then checks again", async () => {
    const d = deps();
    const health = createWriteHealth(d.options);
    await health.check();
    d.advance(29_000);
    await health.check();
    expect(d.calls.embed).toBe(1);
    d.advance(2_000);
    await health.check();
    expect(d.calls.embed).toBe(2);
  });

  it("checks again at once when asked to skip the cache", async () => {
    const d = deps();
    const health = createWriteHealth(d.options);
    await health.check();
    await health.check({ fresh: true });
    expect(d.calls.embed).toBe(2);
  });

  it("shares one probe between checks that start together", async () => {
    const d = deps();
    const health = createWriteHealth(d.options);
    await Promise.all([health.check(), health.check(), health.check({ fresh: true })]);
    expect(d.calls.embed).toBe(1);
  });
});
