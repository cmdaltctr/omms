import { afterAll, expect, it } from "bun:test";
import { EmbeddingService, embeddingServerRequest } from "../src/services/embedding.js";

const seen: Array<{ port: number; auth: string | null; model: string }> = [];
function server(size: number) {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { model: string };
      seen.push({
        port: this.port!,
        auth: request.headers.get("authorization"),
        model: body.model,
      });
      return Response.json({ data: [{ embedding: Array.from({ length: size }, () => 0.5) }] });
    },
  });
}
const small = server(3);
const large = server(5);
afterAll(() => {
  small.stop(true);
  large.stop(true);
});

it("uses an embedding server without a key and sends no Authorization header", async () => {
  seen.length = 0;
  const settings = {
    embeddingApiUrl: `http://127.0.0.1:${small.port}/v1`,
    embeddingModel: "nomic",
  };
  const service = new EmbeddingService(() => settings);
  expect((await service.embed("hello")).length).toBe(3);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((call) => call.auth === null)).toBe(true);
});

it("sends the key when one is set", async () => {
  seen.length = 0;
  const settings = {
    embeddingApiUrl: `http://127.0.0.1:${small.port}/v1`,
    embeddingApiKey: "embed-key",
    embeddingModel: "nomic",
  };
  await new EmbeddingService(() => settings).embed("hello");
  expect(seen.every((call) => call.auth === "Bearer embed-key")).toBe(true);
});

it("uses the built-in model when no URL is set", () => {
  expect(embeddingServerRequest({ embeddingModel: "Xenova/x", embeddingApiKey: "k" })).toBeNull();
  expect(
    embeddingServerRequest({ embeddingApiUrl: "http://localhost:11434/v1", embeddingModel: "m" })
  ).toEqual({
    url: "http://localhost:11434/v1/embeddings",
    headers: { "Content-Type": "application/json" },
  });
});

it("resets its warm state and cache when the embedder settings change", async () => {
  seen.length = 0;
  const settings: { embeddingApiUrl: string; embeddingModel: string } = {
    embeddingApiUrl: `http://127.0.0.1:${small.port}/v1`,
    embeddingModel: "same-model",
  };
  const service = new EmbeddingService(() => settings);
  expect((await service.embed("same text")).length).toBe(3);
  settings.embeddingApiUrl = `http://127.0.0.1:${large.port}/v1`;
  expect((await service.embed("same text")).length).toBe(5);
  expect(seen.some((call) => call.port === large.port)).toBe(true);
});
