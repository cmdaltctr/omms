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
    execPath?: string;
    canRestart?: boolean;
    pathEnv?: string;
    /** True when another caller holds the install lock. */
    lockHeld?: boolean;
    /** What the install check finds after each npm run; null is complete. */
    problems?: (string | null)[];
  } = {}
) {
  const spawns: { command: string; args: string[]; shell: boolean; path?: string }[] = [];
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  const children: (InstallChild & { killed: boolean })[] = [];
  const timeouts: { ms: number; callback: () => void }[] = [];
  let restarts = 0;
  const lockEvents: string[] = [];
  const problems = [...(config.problems ?? [])];
  let problem: string | null = null;
  const npm = config.npm ?? { exit: 0 };
  // The setup check records the release with the restart gate closed, so no
  // automatic install starts; each test then drives requestInstall itself.
  let canRestart = false;
  const deps: WebUpdateDeps = {
    version: "4.9.0",
    enabled: true,
    fetch: (async () =>
      new Response(JSON.stringify({ version: config.latest ?? "4.10.0" }), {
        status: 200,
      })) as unknown as typeof fetch,
    setInterval: () => ({}),
    log: (message, data) => logs.push({ message, data }),
    execPath: config.execPath ?? "/opt/node/bin/node",
    pathEnv: "pathEnv" in config ? config.pathEnv : "/usr/bin:/bin",
    canRestart: () => canRestart,
    killTree: async (child) => {
      (child as InstallChild & { killed: boolean }).killed = true;
      await killDone.promise;
    },
    platform: config.platform ?? "darwin",
    exists: () => config.npmExists ?? true,
    spawn: (command, args, options) => {
      spawns.push({ command, args, shell: options.shell, path: options.path });
      if ("throws" in npm) throw new Error("spawn failed");
      const emitter = new EventEmitter();
      const stderr = new EventEmitter();
      const child = Object.assign(emitter, {
        pid: 4320 + spawns.length,
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
          if (npm.exit === 0) problem = problems.shift() ?? null;
          emitter.emit("exit", npm.exit);
        }
      }, 0);
      return child;
    },
    globalVersion: () => (config.globalAfter === undefined ? "4.10.0" : config.globalAfter),
    // Before npm runs, the global install is at 4.9.0, so the check under the lock finds work.
    installProblem: () => (spawns.length === 0 ? "dist/cli/index.js" : problem),
    installLock: {
      take: () => (lockEvents.push("take"), !config.lockHeld),
      refresh: () => void lockEvents.push("refresh"),
      track: (pid) => void lockEvents.push(`track:${pid}`),
      release: () => void lockEvents.push("release"),
    },
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
  canRestart = config.canRestart ?? true;
  return { update, spawns, logs, children, timeouts, lockEvents, restarts: () => restarts };
}
/** Resolves when the fake npm tree has stopped; a test can hold it open. */
let killDone = { promise: Promise.resolve(), release: () => {} };
function holdKill() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => (release = resolve));
  killDone = { promise, release };
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
      path: "/opt/node/bin:/usr/bin:/bin",
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
        npm: "ran",
        durationMs: 0,
      },
    },
  ]);
  // The lock names npm, so it stays live if this web app exits mid-install.
  expect(f.lockEvents).toEqual(["take", "track:4321", "release"]);
});

it("reports install-busy for the button while another install holds the lock, and runs no npm", async () => {
  const f = await fake({ lockHeld: true });
  expect(f.update.requestInstall()).toBe("accepted");
  await settle();
  expect(f.spawns).toEqual([]);
  expect(f.restarts()).toBe(0);
  expect(f.update.status()).toMatchObject({ state: "failed", code: "install-busy" });
});

it("repairs an empty dependency folder with a second npm run, then restarts", async () => {
  const f = await fake({ problems: ["js-base64", null] });
  f.update.requestInstall();
  await settle();
  expect(f.spawns).toHaveLength(2);
  expect(f.lockEvents).toEqual(["take", "track:4321", "refresh", "track:4322", "release"]);
  expect(f.restarts()).toBe(1);
  expect(f.logs.at(-1)?.data).toMatchObject({
    outcome: "installed",
    npm: "repaired",
    missing: "js-base64",
  });
});

it("keeps serving and reports incomplete-install when the repair fails", async () => {
  const f = await fake({ problems: ["js-base64", "js-base64"] });
  f.update.requestInstall();
  await settle();
  expect(f.spawns).toHaveLength(2);
  expect(f.restarts()).toBe(0);
  expect(f.update.status()).toMatchObject({ state: "failed", code: "incomplete-install" });
  // Codes and the dependency name only: no npm output and no path.
  expect(f.logs.at(-1)).toEqual({
    message: "Web app update",
    data: {
      outcome: "failed",
      code: "incomplete-install",
      from: "4.9.0",
      to: "4.10.0",
      exitCode: 0,
      missing: "js-base64",
      durationMs: 0,
    },
  });
});

it("uses npm.cmd through a shell on Windows", async () => {
  const f = await fake({ platform: "win32" });
  f.update.requestInstall();
  await settle();
  expect(f.spawns[0]?.command.endsWith('npm.cmd"')).toBe(true);
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

it("quotes the npm.cmd path on Windows, so a path with a space stays one command", async () => {
  const f = await fake({ platform: "win32", execPath: "C:\\Program Files\\nodejs\\node.exe" });
  f.update.requestInstall();
  await settle();
  const command = f.spawns[0]!.command;
  expect(command.startsWith('"')).toBe(true);
  expect(command.endsWith('npm.cmd"')).toBe(true);
  expect(command).toContain("Program Files");
});

it("offers no install when the web app could not restart onto the new copy", async () => {
  const f = await fake({ canRestart: false });
  expect(f.update.status().canInstall).toBe(false);
  expect(f.update.requestInstall()).toBe("cannot-install");
  expect(f.spawns).toEqual([]);
});

it("keeps the update running until npm has stopped after a timeout", async () => {
  holdKill();
  const f = await fake({ npm: { hang: true } });
  f.update.requestInstall();
  await settle();
  f.timeouts[0]!.callback();
  await settle();
  // npm is still stopping, so nothing else may start yet.
  expect(f.update.status().state).toBe("installing");
  // npm's own exit from the kill signal must not end the update as a plain npm failure.
  (f.children[0] as unknown as { emit(event: string, code: number): void }).emit("exit", 1);
  await settle();
  expect(f.update.status().state).toBe("installing");
  killDone.release();
  await settle();
  expect(f.update.status()).toMatchObject({ state: "failed", code: "timeout" });
  killDone = { promise: Promise.resolve(), release: () => {} };
});

// A login item starts with PATH=/usr/bin:/bin:/usr/sbin:/sbin, and npm's
// `#!/usr/bin/env node` line then finds no node and exits with 127.
it("puts the folder of this Node.js first on npm's PATH", async () => {
  const f = await fake({ pathEnv: "/usr/bin:/bin:/usr/sbin:/sbin" });
  f.update.requestInstall();
  await settle();
  expect(f.spawns[0]?.path).toBe("/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin");
});

it("gives npm the Node.js folder alone when there is no PATH", async () => {
  const f = await fake({ pathEnv: undefined });
  f.update.requestInstall();
  await settle();
  expect(f.spawns[0]?.path).toBe("/opt/node/bin");
});

it("leaves PATH alone on Windows, where npm.cmd finds node.exe beside itself", async () => {
  const f = await fake({ platform: "win32", execPath: "C:\\node\\node.exe" });
  f.update.requestInstall();
  await settle();
  expect(f.spawns[0]?.path).toBeUndefined();
});
