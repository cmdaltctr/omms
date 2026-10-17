import { afterEach, describe, expect, it } from "bun:test";
import {
  RERANKER_POOL_SIZE,
  RERANKER_TIMEOUT_DEFAULT_MS,
  RERANKER_TIMEOUT_MAX_MS,
  RERANKER_TIMEOUT_MIN_MS,
} from "../src/services/request-timeouts.js";
import { rerankDocuments, rerankSettingsFrom, RerankError } from "../src/services/reranker.js";

type Candidate = { id: string; memory: string };

const SETTINGS = {
  apiUrl: "http://127.0.0.1:3008/v1",
  model: "Qwen3-Reranker-0.6B",
  timeoutMs: 2000,
};

function reply(results: Array<{ index: number; relevance_score: number }>): Response {
  return Response.json({ results });
}

type RecordedCall = { url: string; init?: RequestInit };
function recordingFetch(respond: (call: RecordedCall) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const DOCS: Candidate[] = [
  { id: "mem_a", memory: "first memory" },
  { id: "mem_b", memory: "second memory" },
  { id: "mem_c", memory: "third memory" },
];

describe("rerankDocuments request shape", () => {
  it("posts model, query, documents, and top_n to <url>/rerank with a bearer key", async () => {
    const { fetch, calls } = recordingFetch(() =>
      reply([
        { index: 1, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.4 },
        { index: 2, relevance_score: 0.1 },
      ])
    );
    const result = await rerankDocuments(
      { ...SETTINGS, apiKey: "secret-key" },
      "the query",
      DOCS,
      fetch
    );
    expect(result.ordered.map((doc) => doc.id)).toEqual(["mem_b", "mem_a", "mem_c"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:3008/v1/rerank");
    const init = calls[0]!.init!;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-key");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "Qwen3-Reranker-0.6B",
      query: "the query",
      documents: ["first memory", "second memory", "third memory"],
      top_n: 3,
    });
  });

  it("sends no Authorization header when no key is set", async () => {
    const { fetch, calls } = recordingFetch(() =>
      reply([
        { index: 0, relevance_score: 0.2 },
        { index: 1, relevance_score: 0.8 },
      ])
    );
    await rerankDocuments(SETTINGS, "q", DOCS.slice(0, 2), fetch);
    expect(new Headers(calls[0]!.init!.headers).get("Authorization")).toBeNull();
  });

  it("cuts each document at 4,000 characters", async () => {
    const { fetch, calls } = recordingFetch(() => reply([{ index: 0, relevance_score: 1 }]));
    const long: Candidate = { id: "mem_long", memory: "x".repeat(5000) };
    await rerankDocuments(SETTINGS, "q", [long], fetch);
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.documents[0].length).toBe(4000);
  });

  it("breaks score ties by memory id", async () => {
    const { fetch } = recordingFetch(() =>
      reply([
        { index: 2, relevance_score: 0.5 },
        { index: 1, relevance_score: 0.5 },
        { index: 0, relevance_score: 0.5 },
      ])
    );
    const result = await rerankDocuments(SETTINGS, "q", DOCS, fetch);
    expect(result.ordered.map((doc) => doc.id)).toEqual(["mem_a", "mem_b", "mem_c"]);
  });
});

describe("rerankDocuments failures", () => {
  it("reports an HTTP error with the status", async () => {
    const { fetch } = recordingFetch(() => new Response("nope", { status: 503 }));
    const call = rerankDocuments(SETTINGS, "q", DOCS, fetch);
    await expect(call).rejects.toBeInstanceOf(RerankError);
    await call.catch((error: RerankError) => {
      expect(error.code).toBe("reranker_http_error");
      expect(error.status).toBe(503);
      expect(error.message).not.toContain("nope");
    });
  });

  it("refuses a short reply, a duplicate index, an out-of-range index, and a NaN score", async () => {
    const cases: Array<[string, Array<{ index: number; relevance_score: number }>]> = [
      [
        "short",
        [
          { index: 0, relevance_score: 0.5 },
          { index: 1, relevance_score: 0.4 },
        ],
      ],
      [
        "duplicate",
        [
          { index: 0, relevance_score: 0.5 },
          { index: 0, relevance_score: 0.4 },
          { index: 2, relevance_score: 0.3 },
        ],
      ],
      [
        "out-of-range",
        [
          { index: 0, relevance_score: 0.5 },
          { index: 1, relevance_score: 0.4 },
          { index: 3, relevance_score: 0.3 },
        ],
      ],
      [
        "nan",
        [
          { index: 0, relevance_score: Number.NaN },
          { index: 1, relevance_score: 0.4 },
          { index: 2, relevance_score: 0.3 },
        ],
      ],
    ];
    for (const [name, results] of cases) {
      const { fetch } = recordingFetch(() => reply(results));
      const error = (await rerankDocuments(SETTINGS, "q", DOCS, fetch).catch(
        (failure: RerankError) => failure
      )) as RerankError;
      expect(error.code, name).toBe("reranker_invalid_reply");
    }
  });

  it("refuses a reply that is not JSON or has no results array", async () => {
    for (const body of ["not json", '{"results": {}}', "{}"]) {
      const { fetch } = recordingFetch(
        () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })
      );
      const error = (await rerankDocuments(SETTINGS, "q", DOCS, fetch).catch(
        (failure: RerankError) => failure
      )) as RerankError;
      expect(error.code, body).toBe("reranker_invalid_reply");
    }
  });

  it("redacts the API key from any error message", async () => {
    const { fetch } = recordingFetch(() => {
      throw new TypeError("network failed for Bearer secret-key request");
    });
    const error = (await rerankDocuments(
      { ...SETTINGS, apiKey: "secret-key" },
      "q",
      DOCS,
      fetch
    ).catch((failure: RerankError) => failure)) as RerankError;
    expect(error.code).toBe("reranker_unreachable");
    expect(error.message).not.toContain("secret-key");
    expect(String(error)).not.toContain("secret-key");
  });
});

describe("rerankDocuments timeout", () => {
  it("aborts at 2000 ms and reports reranker_timeout", async () => {
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as typeof fetch;
    const started = Date.now();
    const error = (await rerankDocuments(SETTINGS, "q", DOCS, fetch).catch(
      (failure: RerankError) => failure
    )) as RerankError;
    expect(error.code).toBe("reranker_timeout");
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(error.elapsedMs).toBeGreaterThanOrEqual(1900);
  });

  it("uses the timeout from the settings, not a constant 2000", async () => {
    // A 2,100 ms reply would exceed a 2,000 ms default; the 6,000 ms
    // setting from the argument must let it through.
    const { fetch } = recordingFetch(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(reply([{ index: 0, relevance_score: 1 }])), 2100)
        )
    );
    const result = await rerankDocuments(
      { ...SETTINGS, timeoutMs: 6000 },
      "q",
      [{ id: "mem_a", memory: "only" }],
      fetch
    );
    expect(result.ordered).toEqual([{ id: "mem_a", memory: "only" }]);
  });
});

describe("rerankSettingsFrom", () => {
  afterEach(() => {
    delete process.env.OMMS_TEST_RERANK_KEY;
  });

  it("returns undefined when disabled or when the URL or model is missing", () => {
    const base = {
      rerankerEnabled: false,
      rerankerApiUrl: "http://127.0.0.1:3008/v1",
      rerankerModel: "Qwen3-Reranker-0.6B",
      rerankerTimeoutMs: 2000,
    };
    expect(rerankSettingsFrom(base)).toBeUndefined();
    expect(
      rerankSettingsFrom({ ...base, rerankerEnabled: true, rerankerApiUrl: undefined })
    ).toBeUndefined();
    expect(
      rerankSettingsFrom({ ...base, rerankerEnabled: true, rerankerModel: "" })
    ).toBeUndefined();
  });

  it("maps a ready config, resolving env keys and defaulting the timeout", () => {
    process.env.OMMS_TEST_RERANK_KEY = "resolved-key";
    const settings = rerankSettingsFrom({
      rerankerEnabled: true,
      rerankerApiUrl: "http://127.0.0.1:3008/v1",
      rerankerModel: "Qwen3-Reranker-0.6B",
      rerankerApiKey: "env://OMMS_TEST_RERANK_KEY",
    });
    expect(settings).toEqual({
      apiUrl: "http://127.0.0.1:3008/v1",
      model: "Qwen3-Reranker-0.6B",
      apiKey: "resolved-key",
      timeoutMs: RERANKER_TIMEOUT_DEFAULT_MS,
    });
    const noKey = rerankSettingsFrom({
      rerankerEnabled: true,
      rerankerApiUrl: "http://127.0.0.1:3008/v1",
      rerankerModel: "Qwen3-Reranker-0.6B",
      rerankerTimeoutMs: 6000,
    });
    expect(noKey).toEqual({
      apiUrl: "http://127.0.0.1:3008/v1",
      model: "Qwen3-Reranker-0.6B",
      timeoutMs: 6000,
    });
  });
});

describe("reranker constants", () => {
  it("holds the documented timeout default, range, and pool size", () => {
    expect(RERANKER_TIMEOUT_DEFAULT_MS).toBe(4000);
    expect(RERANKER_TIMEOUT_MIN_MS).toBe(500);
    expect(RERANKER_TIMEOUT_MAX_MS).toBe(30000);
    expect(RERANKER_POOL_SIZE).toBe(50);
  });
});
