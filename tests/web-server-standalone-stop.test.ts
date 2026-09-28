import { expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { createStandaloneOpencodeReader } from "../src/importer/opencode-standalone-models.js";
import { WebServer } from "../src/services/web-server.js";

it("stops a running standalone OpenCode read when the web server stops", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 4343,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    signals: [] as string[],
    kill(signal: NodeJS.Signals = "SIGTERM") {
      child.signals.push(signal);
      queueMicrotask(() => {
        child.signalCode = signal;
        child.emit("exit", null, signal);
      });
      return true;
    },
  });
  let spawned!: () => void;
  const started = new Promise<void>((resolve) => (spawned = resolve));
  // The child never prints a start line, so the read waits until something stops it.
  const read = createStandaloneOpencodeReader({
    spawn: () => {
      spawned();
      return child;
    },
    fetch: async () => new Response("{}"),
    now: () => 0,
    sleep: () => new Promise(() => {}),
    isFile: () => true,
    kill: (target, signal) => {
      target.kill(signal);
    },
    env: {},
    platform: "darwin",
    home: "/home/tester",
    password: () => "fake-password",
    log: () => {},
  })();
  await started;

  const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 48767 });
  await server.start();
  expect(server.isServerOwner()).toBe(true);
  await server.stop();

  expect(child.signals).toEqual(["SIGTERM"]);
  expect(await read).toEqual({ outcome: "start_timeout" });
});
