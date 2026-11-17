import { describe, expect, it, mock } from "bun:test";

// The Settings model list reaches the Pi SDK and starts OpenCode. Stub both edges so
// the test checks only how the web server maps a host value to a reply.
mock.module("../src/importer/pi-sdk.js", () => ({
  loadPiSdk: async () => {
    throw new Error("no Pi SDK in this test");
  },
  resetPiSdkCache: () => {},
}));
mock.module("../src/importer/opencode-standalone-models.js", () => ({
  readStandaloneOpencodeModels: async () => ({ outcome: "not_found" }),
  stopStandaloneOpencodeReads: async () => {},
}));

const { WebServer } = await import("../src/services/web-server.js");
const { getOrCreateAuthToken } = await import("../src/services/auth-token.js");
const { OPENCODE_NOT_FOUND, PI_LIST_UNAVAILABLE } =
  await import("../src/importer/settings-models.js");

const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
const routes = server as unknown as {
  handleRequest(request: Request, address: string): Promise<Response>;
};
const json = { "content-type": "application/json" };

function send(path: string, method = "GET", body?: unknown) {
  return routes.handleRequest(
    new Request(`http://127.0.0.1:4747${path}`, {
      method,
      headers: { "x-omms-token": getOrCreateAuthToken(), ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    "127.0.0.1"
  );
}

async function reply(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe("web server host checks", () => {
  it("lists Settings models for Pi and OpenCode and refuses every other host value", async () => {
    expect(await reply(await send("/api/settings/models?host=pi"))).toEqual({
      status: 200,
      body: { available: false, reason: PI_LIST_UNAVAILABLE },
    });
    expect(await reply(await send("/api/settings/models?host=opencode"))).toEqual({
      status: 200,
      body: { available: false, reason: OPENCODE_NOT_FOUND },
    });
    const refused = { status: 400, body: { error: "Invalid host" } };
    for (const query of ["?host=claude-code", "?host=x", "?host=", ""]) {
      expect(await reply(await send(`/api/settings/models${query}`))).toEqual(refused);
    }
  });

  it("refuses an unknown host when browsing or validating an import source", async () => {
    const refused = { status: 400, body: { error: "Choose Pi, OpenCode, or Claude Code" } };
    for (const action of ["browse", "validate"]) {
      for (const body of [{ host: "x" }, { host: "claude" }, { host: 1 }, { path: "/tmp" }, {}]) {
        expect(
          await reply(await send(`/api/settings/imports/sources/${action}`, "POST", body))
        ).toEqual(refused);
      }
    }
  });

  it("refuses an unknown host in diagnostics and leaves unknown retry and backfill routes unanswered", async () => {
    expect(await reply(await send("/api/settings/diagnostics?host=x"))).toEqual({
      status: 400,
      body: { error: "Invalid host" },
    });
    const missing = [
      ["/api/settings/capture-retry/x/run", "POST"],
      ["/api/settings/backfill/x/run", "POST"],
    ] as const;
    const statuses = [];
    for (const [path, method] of missing) statuses.push((await send(path, method, {})).status);
    expect(statuses).toEqual([404, 404]);
  });

  it("reports the backfill status of the three hosts in the order pi, opencode, claude-code", async () => {
    const response = await send("/api/settings/backfill");
    expect(response.status).toBe(200);
    expect(Object.keys((await response.json()) as object)).toEqual([
      "pi",
      "opencode",
      "claude-code",
    ]);
  });
});
