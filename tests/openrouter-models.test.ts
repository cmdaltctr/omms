import { describe, expect, it } from "bun:test";
import { createOpenRouterModels } from "../src/services/openrouter-models.js";

type Call = { url: string; init?: RequestInit };

/** A stub fetch that answers with a fixed body and records every call. */
function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return { fetchStub, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("createOpenRouterModels", () => {
  it("returns id and name only, with extra fields dropped", async () => {
    const { fetchStub, calls } = stubFetch(() =>
      json({
        data: [{ id: "a/b", name: "A B", pricing: { prompt: "0.1" }, context_length: 1000 }],
      })
    );
    const models = createOpenRouterModels({ fetch: fetchStub, now: () => 0 });
    const result = await models.list();
    expect(result).toEqual({ ok: true, models: [{ id: "a/b", name: "A B" }] });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/models");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(new Headers(calls[0]!.init?.headers).get("accept")).toBe("application/json");
    expect(new Headers(calls[0]!.init?.headers).has("authorization")).toBe(false);
  });

  it("sorts by id, falls back to id for a missing name and skips rows without an id", async () => {
    const { fetchStub } = stubFetch(() =>
      json({
        data: [
          { id: "z/last", name: "Last" },
          { id: "a/first" },
          { id: "m/blank", name: "  " },
          { id: "", name: "Empty" },
          { name: "No id" },
          { id: 5, name: "Number" },
          null,
        ],
      })
    );
    const result = await createOpenRouterModels({ fetch: fetchStub, now: () => 0 }).list();
    expect(result).toEqual({
      ok: true,
      models: [
        { id: "a/first", name: "a/first" },
        { id: "m/blank", name: "m/blank" },
        { id: "z/last", name: "Last" },
      ],
    });
  });

  it("fetches once within an hour and again after an hour", async () => {
    let clock = 1_000;
    const { fetchStub, calls } = stubFetch(() => json({ data: [{ id: "a/b", name: "A" }] }));
    const models = createOpenRouterModels({ fetch: fetchStub, now: () => clock });
    await models.list();
    clock += 59 * 60 * 1000;
    await models.list();
    expect(calls).toHaveLength(1);
    clock += 2 * 60 * 1000;
    await models.list();
    expect(calls).toHaveLength(2);
  });

  it("does not cache a failed read", async () => {
    let fail = true;
    const { fetchStub, calls } = stubFetch(() =>
      fail ? json({}, 503) : json({ data: [{ id: "a/b", name: "A" }] })
    );
    const models = createOpenRouterModels({ fetch: fetchStub, now: () => 0 });
    const first = await models.list();
    expect(first).toMatchObject({ ok: false });
    expect(typeof (first as { error: string }).error).toBe("string");
    fail = false;
    expect(await models.list()).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("reports a timeout as ok false", async () => {
    const { fetchStub } = stubFetch(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const result = await createOpenRouterModels({ fetch: fetchStub, now: () => 0 }).list();
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("10 seconds");
  });

  it("reports an unreachable network as ok false", async () => {
    const { fetchStub } = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const result = await createOpenRouterModels({ fetch: fetchStub, now: () => 0 }).list();
    expect(result).toMatchObject({ ok: false });
    expect(typeof (result as { error: string }).error).toBe("string");
  });

  it("reports a bad shape as ok false", async () => {
    for (const body of [{}, { data: "nope" }, [], null]) {
      const { fetchStub } = stubFetch(() => json(body));
      const result = await createOpenRouterModels({ fetch: fetchStub, now: () => 0 }).list();
      expect(result).toMatchObject({ ok: false });
    }
  });

  it("reports an unreadable body as ok false", async () => {
    const { fetchStub } = stubFetch(() => new Response("<html>", { status: 200 }));
    const result = await createOpenRouterModels({ fetch: fetchStub, now: () => 0 }).list();
    expect(result).toMatchObject({ ok: false });
  });
});
