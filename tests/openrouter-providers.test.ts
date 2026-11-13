import { describe, expect, it } from "bun:test";
import { createOpenRouterProviders } from "../src/services/openrouter-providers.js";

type Call = { url: string; init?: RequestInit };

const MODEL = "deepseek/deepseek-chat";

function endpoint(tag: string, providerName: string, modelId = MODEL) {
  return { tag, provider_name: providerName, model_id: modelId };
}

function zdrRow(tag: string, safety?: boolean, modelId = MODEL) {
  return {
    tag,
    model_id: modelId,
    provider_name: "x",
    ...(safety === undefined ? {} : { safety_retention: safety }),
  };
}

/** A stub fetch that answers the two OpenRouter lists and records every call. */
function stubFetch(options: {
  endpoints?: unknown[];
  zdr?: unknown[];
  modelStatus?: number;
  zdrStatus?: number;
}) {
  const calls: Call[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/endpoints/zdr")) {
      const status = options.zdrStatus ?? 200;
      return new Response(JSON.stringify({ data: options.zdr ?? [] }), { status });
    }
    const status = options.modelStatus ?? 200;
    return new Response(JSON.stringify({ data: { endpoints: options.endpoints ?? [] } }), {
      status,
    });
  }) as typeof fetch;
  return {
    fetchStub,
    calls,
    zdrCalls: () => calls.filter((c) => c.url.endsWith("/endpoints/zdr")),
  };
}

describe("OpenRouter provider list", () => {
  it("returns one row per slug with the right label, sorted by name", async () => {
    const { fetchStub } = stubFetch({
      endpoints: [
        endpoint("novita", "Novita"),
        endpoint("deepinfra/fp4", "DeepInfra"),
        endpoint("streamlake", "StreamLake"),
      ],
      zdr: [zdrRow("deepinfra/fp4", false), zdrRow("streamlake", true)],
    });
    const lists = createOpenRouterProviders({ fetch: fetchStub, now: () => 0 });
    expect(await lists.list(MODEL)).toEqual({
      ok: true,
      providers: [
        { slug: "deepinfra", name: "DeepInfra", policy: "zdr" },
        { slug: "novita", name: "Novita", policy: "unknown" },
        { slug: "streamlake", name: "StreamLake", policy: "safety" },
      ],
    });
  });

  it("gives a slug with several endpoints the label of its least private endpoint", async () => {
    const { fetchStub } = stubFetch({
      endpoints: [
        endpoint("deepinfra/fp4", "DeepInfra"),
        endpoint("deepinfra/fp8", "DeepInfra"),
        endpoint("a/one", "A"),
        endpoint("a/two", "A"),
        endpoint("b/one", "B"),
        endpoint("b/two", "B"),
      ],
      zdr: [
        // deepinfra: one ZDR endpoint, one not on the list -> unknown
        zdrRow("deepinfra/fp4", false),
        // a: zdr and safety -> safety
        zdrRow("a/one", false),
        zdrRow("a/two", true),
        // b: both zdr -> zdr
        zdrRow("b/one", false),
        zdrRow("b/two", false),
      ],
    });
    const result = await createOpenRouterProviders({ fetch: fetchStub, now: () => 0 }).list(MODEL);
    expect(result).toEqual({
      ok: true,
      providers: [
        { slug: "a", name: "A", policy: "safety" },
        { slug: "b", name: "B", policy: "zdr" },
        { slug: "deepinfra", name: "DeepInfra", policy: "unknown" },
      ],
    });
  });

  it("matches a ZDR row on model and tag, and never labels a missing field as zdr", async () => {
    const { fetchStub } = stubFetch({
      endpoints: [
        endpoint("same/tag", "OtherModelRow"),
        { provider_name: "NoTag" },
        { tag: "notag-model/x", provider_name: "NoModel" },
      ],
      zdr: [
        // Same tag but a different model: not a match for this model.
        zdrRow("same/tag", false, "other/model"),
        // The endpoint has no model_id, so a matching row must not make it zdr.
        zdrRow("notag-model/x", false),
        // The endpoint has no tag, so a row cannot match it.
        zdrRow("notag", false),
      ],
    });
    const result = await createOpenRouterProviders({ fetch: fetchStub, now: () => 0 }).list(MODEL);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.providers.map((p) => p.policy)).toEqual(["unknown", "unknown", "unknown"]);
    // A missing tag falls back to the lower-cased provider name.
    expect(result.providers.map((p) => p.slug).sort()).toEqual(["notag", "notag-model", "same"]);
  });

  it("keeps a matching ZDR row unknown when its safety_retention is missing or not a boolean", async () => {
    const { fetchStub } = stubFetch({
      endpoints: [
        endpoint("missing/fp4", "Missing"),
        endpoint("text/fp4", "Text"),
        endpoint("good/fp4", "Good"),
      ],
      zdr: [
        zdrRow("missing/fp4"),
        { ...zdrRow("text/fp4"), safety_retention: "false" },
        zdrRow("good/fp4", false),
      ],
    });
    const result = await createOpenRouterProviders({ fetch: fetchStub, now: () => 0 }).list(MODEL);
    expect(result).toEqual({
      ok: true,
      providers: [
        { slug: "good", name: "Good", policy: "zdr" },
        { slug: "missing", name: "Missing", policy: "unknown" },
        { slug: "text", name: "Text", policy: "unknown" },
      ],
    });
  });

  it("fetches the ZDR list once within an hour and again after it", async () => {
    const { fetchStub, zdrCalls } = stubFetch({
      endpoints: [endpoint("deepinfra", "DeepInfra")],
      zdr: [zdrRow("deepinfra", false)],
    });
    let clock = 1_000;
    const lists = createOpenRouterProviders({ fetch: fetchStub, now: () => clock });
    await lists.list(MODEL);
    clock += 59 * 60_000;
    await lists.list(MODEL);
    expect(zdrCalls()).toHaveLength(1);
    clock += 2 * 60_000;
    await lists.list(MODEL);
    expect(zdrCalls()).toHaveLength(2);
  });

  it("does not cache the model list and does not cache a failed ZDR fetch", async () => {
    const good = stubFetch({ endpoints: [endpoint("a", "A")], zdr: [] });
    let failZdr = true;
    const calls: string[] = [];
    const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/endpoints/zdr") && failZdr) return new Response("nope", { status: 500 });
      return good.fetchStub(input, init);
    }) as typeof fetch;
    const lists = createOpenRouterProviders({ fetch: fetchStub, now: () => 0 });
    const first = await lists.list(MODEL);
    expect(first).toMatchObject({ ok: false, reason: "unreachable" });
    failZdr = false;
    const second = await lists.list(MODEL);
    expect(second).toMatchObject({ ok: true });
    await lists.list(MODEL);
    expect(calls.filter((url) => url.endsWith("/endpoints/zdr"))).toHaveLength(2);
    expect(calls.filter((url) => url.includes("/models/"))).toHaveLength(3);
  });

  it("reports a timeout when a fetch exceeds the limit", async () => {
    const fetchStub = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const lists = createOpenRouterProviders({ fetch: fetchStub, now: () => 0, timeoutMs: 20 });
    const result = await lists.list(MODEL);
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(JSON.stringify(result)).toContain("error");
  });

  it("reports an unknown model for a 404 and for an empty endpoint list", async () => {
    const missing = stubFetch({ modelStatus: 404 });
    expect(
      await createOpenRouterProviders({ fetch: missing.fetchStub, now: () => 0 }).list(MODEL)
    ).toMatchObject({ ok: false, reason: "unknown-model" });
    const empty = stubFetch({ endpoints: [] });
    expect(
      await createOpenRouterProviders({ fetch: empty.fetchStub, now: () => 0 }).list(MODEL)
    ).toMatchObject({ ok: false, reason: "unknown-model" });
  });

  it("reports unreachable for a network error, a server error and bad JSON", async () => {
    const network = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(
      await createOpenRouterProviders({ fetch: network, now: () => 0 }).list(MODEL)
    ).toMatchObject({ ok: false, reason: "unreachable" });
    const server = stubFetch({ modelStatus: 503 });
    expect(
      await createOpenRouterProviders({ fetch: server.fetchStub, now: () => 0 }).list(MODEL)
    ).toMatchObject({ ok: false, reason: "unreachable" });
    const badJson = (async () =>
      new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    expect(
      await createOpenRouterProviders({ fetch: badJson, now: () => 0 }).list(MODEL)
    ).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("sends no key and only the encoded model ID", async () => {
    const { fetchStub, calls } = stubFetch({ endpoints: [endpoint("a", "A")] });
    await createOpenRouterProviders({ fetch: fetchStub, now: () => 0 }).list("meta/llama-3:free");
    const urls = calls.map((call) => call.url).sort();
    expect(urls).toEqual([
      "https://openrouter.ai/api/v1/endpoints/zdr",
      "https://openrouter.ai/api/v1/models/meta/llama-3%3Afree/endpoints",
    ]);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(call.init?.body).toBeUndefined();
      expect(call.init?.signal).toBeDefined();
    }
  });
});
