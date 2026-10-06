import { expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  INSTALL_TIMEOUT_MS,
  npmFailureCode,
  WebUpdate,
  type InstallChild,
  type WebUpdateDeps,
} from "../src/services/web-update.js";

/** How the fake npm ends. */
type NpmEnd =
  { exit: number; stderr?: string } | { error: true } | { hang: true } | { throws: true };

/** A web app 4.9.0 that sees `latest` on npm and runs a fake npm. */
async function fake(
  config: {
    latest?: string;
    npm?: NpmEnd;
    npmExists?: boolean;
    globalAfter?: string | null;
    restartCode?: string;
    platform?: NodeJS.Platform;
  } = {}
) {
  const spawns: { command: string; args: string[]; shell: boolean }[] = [];
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  const children: (InstallChild & { killed: boolean })[] = [];
  const timeouts: { ms: number; callback: () => void }[] = [];
  let restarts = 0;
  const npm = config.npm ?? { exit: 0 };
  const deps: WebUpdateDeps = {
    version: "4.9.0",
    enabled: true,
    fetch: (async () =>
      new Response(JSON.stringify({ version: config.latest ?? "4.10.0" }), {
        status: 200,
      })) as unknown as typeof fetch,
    setInterval: () => ({}),
    log: (message, data) => logs.push({ message, data }),
    execPath: "/opt/node/bin/node",
    platform: config.platform ?? "darwin",
    exists: () => config.npmExists ?? true,
    spawn: (command, args, options) => {
      spawns.push({ command, args, shell: options.shell });
      if ("throws" in npm) throw new Error("spawn failed");
      const emitter = new EventEmitter();
      const stderr = new EventEmitter();
      const child = Object.assign(emitter, {
        stderr,
        killed: false,
        kill: () => {
          child.killed = true;
          return true;
        },
      }) as unknown as InstallChild & { killed: boolean };
      children.push(child);
      setTimeout(() => {
        if ("error" in npm) emitter.emit("error", new Error("ENOENT"));
        if ("exit" in npm) {
          if (npm.stderr) stderr.emit("data", Buffer.from(npm.stderr));
          emitter.emit("exit", npm.exit);
        }
      }, 0);
      return child;
    },
    globalVersion: () => (config.globalAfter === undefined ? "4.10.0" : config.globalAfter),
    restart: async () => {
      restarts++;
      return config.restartCode;
    },
    setTimeout: (callback, ms) => {
      timeouts.push({ ms, callback });
      return timeouts.length;
    },
    clearTimeout: () => {},
    now: () => 0,
  };
  const update = new WebUpdate(deps);
  await update.check();
  return { update, spawns, logs, children, timeouts, restarts: () => restarts };
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

it("installs with the npm beside Node.js and restarts onto the new copy", async () => {
  const f = await fake();
  expect(f.update.requestInstall()).toBe("accepted");
  expect(f.update.status().state).toBe("installing");
  await settle();
  expect(f.spawns).toEqual([
    {
      command: "/opt/node/bin/npm",
      args: ["install", "-g", "om-memory-system@4.10.0"],
      shell: false,
    },
  ]);
  expect(f.restarts()).toBe(1);
  expect(f.logs).toEqual([
    {
      message: "Web app update",
      data: {
        outcome: "installed",
        code: null,
        from: "4.9.0",
        to: "4.10.0",
        exitCode: 0,
        durationMs: 0,
      },
    },
  ]);
});

it("uses npm.cmd through a shell on Windows", async () => {
  const f = await fake({ platform: "win32" });
  f.update.requestInstall();
  await settle();
  expect(f.spawns[0]?.command.endsWith("npm.cmd")).toBe(true);
  expect(f.spawns[0]?.shell).toBe(true);
});

it("reports permission, network, and other npm failures by code without npm output", async () => {
  const cases: [string, string][] = [
    ["npm ERR! code EACCES\nnpm ERR! path /usr/lib/node_modules secret-path", "permission"],
    ["npm ERR! code ENOTFOUND registry.npmjs.org", "network"],
    ["npm ERR! something else", "npm-exit"],
  ];
  for (const [stderr, code] of cases) {
    const f = await fake({ npm: { exit: 1, stderr } });
    f.update.requestInstall();
    await settle();
    expect(f.update.status()).toMatchObject({ state: "failed", code });
    expect(f.restarts()).toBe(0);
    expect(JSON.stringify(f.logs)).not.toContain("npm ERR");
    expect(JSON.stringify(f.logs)).not.toContain("secret-path");
  }
});

it("stops npm after 5 minutes and keeps serving", async () => {
  const f = await fake({ npm: { hang: true } });
  f.update.requestInstall();
  await settle();
  expect(f.timeouts.map((timeout) => timeout.ms)).toEqual([INSTALL_TIMEOUT_MS]);
  f.timeouts[0]!.callback();
  await settle();
  expect(f.children[0]?.killed).toBe(true);
  expect(f.update.status()).toMatchObject({ state: "failed", code: "timeout" });
  expect(f.restarts()).toBe(0);
});

it("reports a spawn error when npm cannot start", async () => {
  for (const npm of [{ error: true }, { throws: true }] as const) {
    const f = await fake({ npm });
    f.update.requestInstall();
    await settle();
    expect(f.update.status()).toMatchObject({ state: "failed", code: "spawn-error" });
  }
});

it("refuses to install when no npm sits beside Node.js", async () => {
  const f = await fake({ npmExists: false });
  expect(f.update.status().canInstall).toBe(false);
  expect(f.update.requestInstall()).toBe("cannot-install");
  expect(f.spawns).toEqual([]);
});

it("refuses to install when there is no update", async () => {
  const f = await fake({ latest: "4.9.0" });
  expect(f.update.requestInstall()).toBe("no-update");
  expect(f.spawns).toEqual([]);
});

it("offers no install for a registry version that is not a plain release", async () => {
  const f = await fake({ latest: "4.10.0; rm -rf /" });
  expect(f.update.requestInstall()).toBe("no-update");
  expect(f.spawns).toEqual([]);
});

it("does not restart when the global install reports another version", async () => {
  const f = await fake({ globalAfter: "4.9.0" });
  f.update.requestInstall();
  await settle();
  expect(f.update.status()).toMatchObject({ state: "failed", code: "version-mismatch" });
  expect(f.restarts()).toBe(0);
});

it("reports the restart code when the web app keeps serving", async () => {
  const f = await fake({ restartCode: "no-launcher" });
  f.update.requestInstall();
  await settle();
  expect(f.update.status()).toMatchObject({ state: "failed", code: "no-launcher" });
});

it("starts one install for repeated requests", async () => {
  const f = await fake({ npm: { hang: true } });
  expect(f.update.requestInstall()).toBe("accepted");
  expect(f.update.requestInstall()).toBe("accepted");
  await settle();
  expect(f.spawns.length).toBe(1);
});

it("maps npm error text to a code", () => {
  expect(npmFailureCode("EPERM: operation not permitted")).toBe("permission");
  expect(npmFailureCode("getaddrinfo EAI_AGAIN")).toBe("network");
  expect(npmFailureCode("")).toBe("npm-exit");
});
