import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("plugin shutdown", () => {
  it("does not force host process exit from signal handlers", () => {
    const source = readFileSync(new URL("../src/v2/startup.ts", import.meta.url), "utf-8");

    expect(source).not.toContain("process.exit(");
  });

  it("clears pending idle auto-capture work during cleanup", () => {
    const startup = readFileSync(new URL("../src/v2/startup.ts", import.meta.url), "utf-8");
    const events = readFileSync(new URL("../src/v2/session-events.ts", import.meta.url), "utf-8");

    expect(startup).toContain("onCleanup()");
    expect(events).toContain("clearTimeout(idleTimeout)");
    expect(events).toContain("idleTimeout = null");
  });
});
