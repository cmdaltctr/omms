import { describe, expect, it } from "bun:test";
import {
  assertWebServerNetworkAuth,
  authorizeApiRequest,
  isLoopbackHost,
} from "../src/services/web-api-auth.js";

describe("web api auth", () => {
  it("detects loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("requires an api token or a password for non-loopback hosts", () => {
    expect(() => assertWebServerNetworkAuth("0.0.0.0")).toThrow(/API token.*browser password/);
    expect(() => assertWebServerNetworkAuth("0.0.0.0", true)).not.toThrow();
    expect(() => assertWebServerNetworkAuth("0.0.0.0", false, true)).not.toThrow();
    expect(() => assertWebServerNetworkAuth("127.0.0.1")).not.toThrow();
  });

  it("authorizes bearer and custom header tokens", () => {
    const token = (value: string) => value === "test-token";
    expect(authorizeApiRequest(new Request("http://localhost/api/stats"), token)?.status).toBe(401);
    expect(
      authorizeApiRequest(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer test-token" },
        }),
        token
      )
    ).toBeNull();
    expect(
      authorizeApiRequest(
        new Request("http://localhost/api/stats", {
          headers: { "X-Omms-Token": "test-token" },
        }),
        token
      )
    ).toBeNull();
    // Legacy opencode-mem header stays accepted for existing API clients.
    expect(
      authorizeApiRequest(
        new Request("http://localhost/api/stats", {
          headers: { "X-Opencode-Mem-Token": "test-token" },
        }),
        token
      )
    ).toBeNull();
    expect(
      authorizeApiRequest(
        new Request("http://localhost/api/stats", {
          headers: { "X-Omms-Token": "wrong" },
        }),
        token
      )?.status
    ).toBe(401);
  });
});
