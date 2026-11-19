import { afterEach, expect, it } from "bun:test";
import {
  getSettingsSnapshot,
  memoryKeyStatus,
  type SnapshotConfigModule,
} from "../src/services/settings-snapshot.js";
import {
  testEmbeddingCandidate,
  type EmbeddingCandidate,
} from "../src/services/embedding-change.js";

// Both modules read config the caller passes, on each call. A reload replaces CONFIG, so a copy
// kept between calls would show the old value.

type FakeConfig = Record<string, unknown>;
const fakeModule = (config: FakeConfig): SnapshotConfigModule =>
  ({
    CONFIG: config,
    getGlobalConfigSourcePath: () => undefined,
    getLastGoodGlobalFileConfig: () => ({}),
  }) as unknown as SnapshotConfigModule;

it("settings snapshot shows the value of CONFIG at the time of each call", () => {
  const config: FakeConfig = {
    embeddingApiUrl: "http://first.invalid/v1",
    embeddingModel: "m",
    memoryModel: "first-model",
    memoryApiKey: "k",
    webServerHost: "127.0.0.1",
  };
  const module = fakeModule(config);
  const first = getSettingsSnapshot(process.cwd(), module);
  expect(first.access.embeddingApiUrl).toBe("http://first.invalid/v1");
  expect(first.fallback.model).toBe("first-model");
  expect(first.access.host).toBe("127.0.0.1");

  // The module's CONFIG is replaced, as config.ts does on a reload.
  (module as { CONFIG: FakeConfig }).CONFIG = {
    ...config,
    embeddingApiUrl: "http://second.invalid/v1",
    memoryModel: "second-model",
    webServerHost: "0.0.0.0",
  };
  const second = getSettingsSnapshot(process.cwd(), module);
  expect(second.access.embeddingApiUrl).toBe("http://second.invalid/v1");
  expect(second.fallback.model).toBe("second-model");
  expect(second.access.host).toBe("0.0.0.0");
});

it("memoryKeyStatus reports whether the key passed in is set", () => {
  expect(memoryKeyStatus("env://X", "set").resolvesInWebApp).toBe(true);
  expect(memoryKeyStatus("env://X", undefined).resolvesInWebApp).toBe(false);
});

const servers: { stop: (force?: boolean) => void }[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.stop(true)));

it("the saved embedding key is the one in the config passed to each test", async () => {
  const seen: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      seen.push(request.headers.get("authorization"));
      return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    },
  });
  servers.push(server);
  const candidate: EmbeddingCandidate = {
    kind: "server",
    url: `http://127.0.0.1:${server.port}/v1`,
    model: "fake-model",
    key: { source: "saved" },
  };
  const config = { embeddingApiKey: "first-key" };
  expect((await testEmbeddingCandidate(candidate, config)).ok).toBe(true);
  config.embeddingApiKey = "second-key";
  expect((await testEmbeddingCandidate(candidate, config)).ok).toBe(true);
  // One test can send more than one request, so compare the keys in order of first use.
  expect([...new Set(seen)]).toEqual(["Bearer first-key", "Bearer second-key"]);
});
