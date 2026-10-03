import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaudeHookCommand } from "../src/adapters/claude-code/hook-command.js";
import { buildClaudeStatus } from "../src/adapters/claude-code/status.js";
import { packageVersion } from "../src/services/package-version.js";

const CLI = join(import.meta.dir, "../src/cli/index.ts");
const CONFIG = { webServerHost: "127.0.0.1", webServerPort: 4747 };

const npmReply = (version: string) => async () =>
  new Response(JSON.stringify({ version }), { status: 200 });
const npmDown = async () => {
  throw new Error("offline");
};

describe("buildClaudeStatus", () => {
  it("reports the health URL, the running version and the npm latest version", async () => {
    const status = await buildClaudeStatus({
      config: { webServerHost: "127.0.0.1", webServerPort: 5151 },
      version: "4.3.3",
      fetch: npmReply("4.4.0") as unknown as typeof fetch,
      checkUpdates: true,
    });
    expect(status).toEqual({
      healthUrl: "http://127.0.0.1:5151/api/health",
      version: "4.3.3",
      latest: "4.4.0",
    });
  });

  it("brackets an IPv6 host and points a wildcard host at loopback", async () => {
    const v6 = await buildClaudeStatus({
      config: { webServerHost: "::1", webServerPort: 4747 },
      version: "4.3.3",
      fetch: npmDown as unknown as typeof fetch,
      checkUpdates: false,
    });
    expect(v6.healthUrl).toBe("http://[::1]:4747/api/health");
    const wildcard = await buildClaudeStatus({
      config: { webServerHost: "0.0.0.0", webServerPort: 4747 },
      version: "4.3.3",
      fetch: npmDown as unknown as typeof fetch,
      checkUpdates: false,
    });
    expect(wildcard.healthUrl).toBe("http://127.0.0.1:4747/api/health");
  });

  it("gives latest null and never asks npm when the check is off", async () => {
    let calls = 0;
    const status = await buildClaudeStatus({
      config: CONFIG,
      version: "4.3.3",
      fetch: (async () => {
        calls += 1;
        return new Response("{}");
      }) as unknown as typeof fetch,
      checkUpdates: false,
    });
    expect(status.latest).toBeNull();
    expect(calls).toBe(0);
  });

  it("gives latest null when npm cannot be reached", async () => {
    const status = await buildClaudeStatus({
      config: CONFIG,
      version: "4.3.3",
      fetch: npmDown as unknown as typeof fetch,
      checkUpdates: true,
    });
    expect(status.latest).toBeNull();
  });
});

describe("claude-hook status", () => {
  it("prints one JSON line and exits 0", async () => {
    const out: string[] = [];
    const code = await runClaudeHookCommand(["status"], {
      writeStdout: (text) => out.push(text),
      fetch: npmReply("4.4.0") as unknown as typeof fetch,
      statusInputs: async () => ({ config: CONFIG, version: "4.3.3", checkUpdates: true }),
    });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]!.endsWith("\n")).toBe(true);
    expect(JSON.parse(out[0]!)).toEqual({
      healthUrl: "http://127.0.0.1:4747/api/health",
      version: "4.3.3",
      latest: "4.4.0",
    });
  });

  it("exits 0 with latest null when npm fails", async () => {
    const out: string[] = [];
    const code = await runClaudeHookCommand(["status"], {
      writeStdout: (text) => out.push(text),
      fetch: npmDown as unknown as typeof fetch,
      statusInputs: async () => ({ config: CONFIG, version: "4.3.3", checkUpdates: true }),
    });
    expect(code).toBe(0);
    expect(JSON.parse(out[0]!).latest).toBeNull();
  });

  it("exits 0 and prints nothing when it cannot read its inputs", async () => {
    const out: string[] = [];
    const code = await runClaudeHookCommand(["status"], {
      writeStdout: (text) => out.push(text),
      statusInputs: async () => {
        throw new Error("broken config");
      },
    });
    expect(code).toBe(0);
    expect(out).toEqual([]);
  });
});

describe("om-memory-system claude-hook status (process)", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "omms-status-"));
    mkdirSync(join(base, "home"), { recursive: true });
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("prints its own version and no latest when OMMS_DISABLE_UPDATE_CHECK=1", () => {
    const result = spawnSync("bun", ["run", CLI, "claude-hook", "status"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: join(base, "home"),
        USERPROFILE: join(base, "home"),
        OMMS_NO_HANDOFF: "1",
        OMMS_DISABLE_UPDATE_CHECK: "1",
      },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      healthUrl: "http://127.0.0.1:4747/api/health",
      version: packageVersion(),
      latest: null,
    });
  });
});
