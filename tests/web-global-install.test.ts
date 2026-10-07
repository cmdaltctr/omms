import { expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  INSTALL_TIMEOUT_MS,
  runGlobalInstall,
  type InstallChild,
  type InstallDeps,
} from "../src/services/web-update.js";

// The npm runner that the update button and `web update` share.

type NpmEnd =
  { exit: number; stderr?: string } | { error: true } | { hang: true } | { throws: true };

function fakeNpm(npm: NpmEnd) {
  const spawns: { command: string; args: string[] }[] = [];
  const timeouts: { ms: number; callback: () => void }[] = [];
  const killed: InstallChild[] = [];
  const deps: InstallDeps = {
    execPath: "/opt/node/bin/node",
    platform: "darwin",
    spawn: (command, args) => {
      spawns.push({ command, args });
      if ("throws" in npm) throw new Error("spawn failed");
      const emitter = new EventEmitter();
      const stderr = new EventEmitter();
      const child = Object.assign(emitter, { stderr, kill: () => true }) as unknown as InstallChild;
      setTimeout(() => {
        if ("error" in npm) emitter.emit("error", new Error("ENOENT"));
        if ("exit" in npm) {
          if (npm.stderr) stderr.emit("data", Buffer.from(npm.stderr));
          emitter.emit("exit", npm.exit);
        }
      }, 0);
      return child;
    },
    killTree: async (child) => {
      killed.push(child);
    },
    setTimeout: (callback, ms) => {
      timeouts.push({ ms, callback });
      return timeouts.length;
    },
    clearTimeout: () => {},
  };
  return { deps, spawns, timeouts, killed };
}

it("installs the target with the npm beside Node.js", async () => {
  const npm = fakeNpm({ exit: 0 });
  expect(await runGlobalInstall(npm.deps, "4.10.0")).toEqual({ code: null, exitCode: 0 });
  expect(npm.spawns).toEqual([
    { command: "/opt/node/bin/npm", args: ["install", "-g", "om-memory-system@4.10.0"] },
  ]);
});

it("maps a permission error", async () => {
  const npm = fakeNpm({ exit: 243, stderr: "npm ERR! code EACCES" });
  expect((await runGlobalInstall(npm.deps, "4.10.0")).code).toBe("permission");
});

it("maps a network error", async () => {
  const npm = fakeNpm({ exit: 1, stderr: "npm ERR! code ENOTFOUND" });
  expect((await runGlobalInstall(npm.deps, "4.10.0")).code).toBe("network");
});

it("maps any other failure to npm-exit", async () => {
  const npm = fakeNpm({ exit: 1, stderr: "npm ERR! something else" });
  expect(await runGlobalInstall(npm.deps, "4.10.0")).toEqual({ code: "npm-exit", exitCode: 1 });
});

it("reports a spawn error event and a throwing spawn", async () => {
  expect((await runGlobalInstall(fakeNpm({ error: true }).deps, "4.10.0")).code).toBe(
    "spawn-error"
  );
  expect((await runGlobalInstall(fakeNpm({ throws: true }).deps, "4.10.0")).code).toBe(
    "spawn-error"
  );
});

it("stops npm after the timeout", async () => {
  const npm = fakeNpm({ hang: true });
  const result = runGlobalInstall(npm.deps, "4.10.0");
  expect(npm.timeouts[0]?.ms).toBe(INSTALL_TIMEOUT_MS);
  npm.timeouts[0]!.callback();
  expect((await result).code).toBe("timeout");
  expect(npm.killed).toHaveLength(1);
});

it("refuses a target that is not a plain release, before npm runs", async () => {
  const npm = fakeNpm({ exit: 0 });
  expect((await runGlobalInstall(npm.deps, "4.10.0; rm -rf ~")).code).toBe("bad-version");
  expect(npm.spawns).toHaveLength(0);
});
