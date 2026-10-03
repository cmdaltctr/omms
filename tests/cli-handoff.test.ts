import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handOffOrRegister,
  ownPackageRoot,
  registerOwnCopy,
  replaceHeaders,
} from "../src/services/runtime-handoff.js";
import { readRuntimeRecord, recordPath, registerCopy } from "../src/services/runtime-record.js";
import { packageVersion } from "../src/services/package-version.js";

const CLI = join(import.meta.dir, "../src/cli/index.ts");

let base: string;
let home: string;
let dir: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omms-handoff-"));
  home = join(base, "home");
  dir = join(home, ".omms");
  mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/** A fake OMMS copy whose CLI prints its version and arguments, and exits with `FAKE_EXIT`. */
function makeCopy(name: string, version: string): string {
  const root = join(base, name);
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "om-memory-system", version }));
  writeFileSync(
    join(root, "dist", "cli", "index.js"),
    `console.log(JSON.stringify({ version: ${JSON.stringify(version)}, args: process.argv.slice(2), handedOff: process.env.OMMS_HANDED_OFF ?? null }));
process.exit(Number(process.env.FAKE_EXIT ?? 0));
`
  );
  return root;
}

describe("handOffOrRegister", () => {
  const own = () => makeCopy("own", "4.3.0");

  it("runs a newer recorded copy and returns its exit code", async () => {
    const root = own();
    registerCopy({ dir, root: makeCopy("newer", "4.3.2") });
    const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const code = await handOffOrRegister(["memory", "search", "x"], {
      dir,
      ownRoot: root,
      ownVersion: "4.3.0",
      env: {},
      spawn: async (command, args, env) => {
        calls.push({ command, args, env });
        return 5;
      },
    });
    expect(code).toBe(5);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual([
      join(base, "newer", "dist", "cli", "index.js"),
      "memory",
      "search",
      "x",
    ]);
    expect(calls[0]!.env.OMMS_HANDED_OFF).toBe("1");
  });

  it("does not hand off when the record names its own copy", async () => {
    const root = own();
    registerCopy({ dir, root });
    const code = await handOffOrRegister(["web"], {
      dir,
      ownRoot: root,
      ownVersion: "4.3.0",
      env: {},
      spawn: async () => {
        throw new Error("must not spawn");
      },
    });
    expect(code).toBeNull();
  });

  it("does not hand off when OMMS_NO_HANDOFF is 1", async () => {
    registerCopy({ dir, root: makeCopy("newer", "4.3.2") });
    const code = await handOffOrRegister(["web"], {
      dir,
      ownRoot: own(),
      ownVersion: "4.3.0",
      env: { OMMS_NO_HANDOFF: "1" },
      spawn: async () => {
        throw new Error("must not spawn");
      },
    });
    expect(code).toBeNull();
  });

  it("hands off when OMMS_NO_HANDOFF is any other value", async () => {
    registerCopy({ dir, root: makeCopy("newer", "4.3.2") });
    const code = await handOffOrRegister(["web"], {
      dir,
      ownRoot: own(),
      ownVersion: "4.3.0",
      env: { OMMS_NO_HANDOFF: "0" },
      spawn: async () => 0,
    });
    expect(code).toBe(0);
  });

  it("does not hand off a second time when OMMS_HANDED_OFF is set", async () => {
    registerCopy({ dir, root: makeCopy("newer", "4.3.2") });
    const code = await handOffOrRegister(["web"], {
      dir,
      ownRoot: own(),
      ownVersion: "4.3.0",
      env: { OMMS_HANDED_OFF: "1" },
      spawn: async () => {
        throw new Error("must not spawn");
      },
    });
    expect(code).toBeNull();
  });

  it("registers itself and continues when the record is older", async () => {
    registerCopy({ dir, root: makeCopy("older", "4.2.0") });
    const root = own();
    const code = await handOffOrRegister(["web"], {
      dir,
      ownRoot: root,
      ownVersion: "4.3.0",
      env: {},
      spawn: async () => {
        throw new Error("must not spawn");
      },
    });
    expect(code).toBeNull();
    expect(readRuntimeRecord(dir)?.root).toBe(root);
  });

  it("registers itself when there is no record", async () => {
    const root = own();
    expect(
      await handOffOrRegister(["web"], { dir, ownRoot: root, ownVersion: "4.3.0", env: {} })
    ).toBeNull();
    expect(readRuntimeRecord(dir)?.root).toBe(root);
  });

  it("ignores a record whose copy is gone", async () => {
    const gone = makeCopy("gone", "9.0.0");
    registerCopy({ dir, root: gone });
    rmSync(gone, { recursive: true });
    const root = own();
    const code = await handOffOrRegister(["web"], {
      dir,
      ownRoot: root,
      ownVersion: "4.3.0",
      env: {},
      spawn: async () => {
        throw new Error("must not spawn");
      },
    });
    expect(code).toBeNull();
    expect(readRuntimeRecord(dir)?.root).toBe(root);
  });

  it("continues with its own code when the newer copy cannot start", async () => {
    registerCopy({ dir, root: makeCopy("newer", "4.3.2") });
    const code = await handOffOrRegister(["web"], {
      dir,
      ownRoot: own(),
      ownVersion: "4.3.0",
      env: {},
      spawn: async () => null,
    });
    expect(code).toBeNull();
  });

  it("does not register when it hands off", async () => {
    const newer = makeCopy("newer", "4.3.2");
    registerCopy({ dir, root: newer });
    await handOffOrRegister(["web"], {
      dir,
      ownRoot: own(),
      ownVersion: "4.3.0",
      env: {},
      spawn: async () => 0,
    });
    expect(readRuntimeRecord(dir)?.root).toBe(newer);
  });

  it("finds its own package root from source", () => {
    expect(ownPackageRoot()).toBe(join(import.meta.dir, ".."));
  });
});

describe("replaceHeaders", () => {
  it("sends only the local token when no browser password is set", async () => {
    expect(await replaceHeaders("tok")).toEqual({ "x-omms-token": "tok" });
    expect(await replaceHeaders("tok", { webServerAuthPassword: "   " })).toEqual({
      "x-omms-token": "tok",
    });
  });

  it("adds Basic Auth with the configured user name when a browser password is set", async () => {
    expect(
      await replaceHeaders("tok", { webServerAuthPassword: "pw", webServerAuthUsername: "me" })
    ).toEqual({ "x-omms-token": "tok", authorization: `Basic ${btoa("me:pw")}` });
  });

  it("defaults the user name the way the web server does", async () => {
    const headers = await replaceHeaders("tok", { webServerAuthPassword: "pw" });
    const decoded = atob(String(headers.authorization).replace("Basic ", ""));
    expect(decoded.endsWith(":pw")).toBe(true);
    expect(decoded.length).toBeGreaterThan(3);
  });
});

describe("registerOwnCopy", () => {
  it("writes nothing to the default folder when OMMS_DISABLE_RUNTIME_RECORD=1", () => {
    const before = process.env.OMMS_DISABLE_RUNTIME_RECORD;
    process.env.OMMS_DISABLE_RUNTIME_RECORD = "1";
    try {
      expect(registerOwnCopy({ root: makeCopy("a", "4.3.0") })).toBe("skipped");
    } finally {
      if (before === undefined) delete process.env.OMMS_DISABLE_RUNTIME_RECORD;
      else process.env.OMMS_DISABLE_RUNTIME_RECORD = before;
    }
  });

  it("still writes to a folder the caller names", () => {
    const before = process.env.OMMS_DISABLE_RUNTIME_RECORD;
    process.env.OMMS_DISABLE_RUNTIME_RECORD = "1";
    try {
      const root = makeCopy("a", "4.3.0");
      expect(registerOwnCopy({ dir, root })).toBe("written");
    } finally {
      if (before === undefined) delete process.env.OMMS_DISABLE_RUNTIME_RECORD;
      else process.env.OMMS_DISABLE_RUNTIME_RECORD = before;
    }
  });
});

describe("om-memory-system command", () => {
  function run(args: string[], env: Record<string, string> = {}) {
    return spawnSync("bun", ["run", CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
    });
  }

  it("prints the newer copy's version after a hand-off", () => {
    registerCopy({ dir, root: makeCopy("newer", "999.0.0") });
    const result = run(["--version"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: "999.0.0",
      args: ["--version"],
      handedOff: "1",
    });
  });

  it("reports the newer copy's version for claude-hook status", () => {
    registerCopy({ dir, root: makeCopy("newer", "999.0.0") });
    const result = run(["claude-hook", "status"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: "999.0.0",
      args: ["claude-hook", "status"],
      handedOff: "1",
    });
    // Without the hand-off, this copy would answer with its own version. The npm
    // lookup is off: a real registry call can outlast the test's 5 second limit.
    const own = run(["claude-hook", "status"], {
      OMMS_NO_HANDOFF: "1",
      OMMS_DISABLE_UPDATE_CHECK: "1",
    });
    expect(JSON.parse(own.stdout).version).not.toBe("999.0.0");
  });

  it("exits with the newer copy's exit code and passes its arguments", () => {
    registerCopy({ dir, root: makeCopy("newer", "999.0.0") });
    const result = run(["memory", "search", "database choice"], { FAKE_EXIT: "4" });
    expect(result.status).toBe(4);
    expect(JSON.parse(result.stdout).args).toEqual(["memory", "search", "database choice"]);
  });

  it("prints its own version when OMMS_NO_HANDOFF=1", () => {
    registerCopy({ dir, root: makeCopy("newer", "999.0.0") });
    const result = run(["--version"], { OMMS_NO_HANDOFF: "1" });
    expect(result.stdout.trim()).toBe(packageVersion());
  });

  it("prints its own version when OMMS_HANDED_OFF is set", () => {
    registerCopy({ dir, root: makeCopy("newer", "999.0.0") });
    const result = run(["--version"], { OMMS_HANDED_OFF: "1" });
    expect(result.stdout.trim()).toBe(packageVersion());
  });

  it("leaves a record that names the newer copy untouched", () => {
    registerCopy({ dir, root: makeCopy("newer", "999.0.0") });
    run(["--version"], { OMMS_NO_HANDOFF: "1" });
    expect(readRuntimeRecord(dir)?.version).toBe("999.0.0");
    expect(recordPath(dir)).toContain(".omms");
  });
});
