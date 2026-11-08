import { afterEach, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPiSelfUpdate,
  piHostSelfUpdateDeps,
  type PiUpdateSession,
} from "../src/adapters/pi/self-update.js";
import {
  type HostSelfUpdateDeps,
  type HostUpdateMarker,
  type HostUpdateStatus,
} from "../src/services/host-self-update.js";
import { packageVersion } from "../src/services/package-version.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const COMMAND = "pi update npm:om-memory-system";

/** Host deps at `current` with npm `latest`. Nothing touches npm, a process or the real home. */
function fakeHost(options: {
  current?: string;
  latest?: string | null;
  enabled?: boolean;
  source?: "npm" | "local" | "pinned";
  /** The versions found on disk. Defaults to the new release being there. */
  installed?: string[];
  marker?: HostUpdateMarker | null;
}) {
  const spawned: { command: string; args: string[] }[] = [];
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  let marker = options.marker ?? null;
  let installed = options.installed ?? ["4.3.0"];
  const deps: HostSelfUpdateDeps = {
    enabled: options.enabled ?? true,
    logLabel: "Pi plugin self-update",
    currentVersion: options.current ?? "4.2.0",
    command: "pi",
    args: ["update", "npm:om-memory-system"],
    markerPath: "/fake/.omms/pi-plugin-update.json",
    installSource: () => options.source ?? "npm",
    fetch: (async () => {
      if (options.latest === null) throw new Error("offline");
      return new Response(JSON.stringify({ version: options.latest ?? "4.3.0" }), { status: 200 });
    }) as unknown as typeof fetch,
    now: () => 1_000_000,
    readMarker: () => marker,
    writeMarker: (value) => {
      marker = value;
    },
    installedVersions: () => installed,
    spawnDetached: (command, args) => spawned.push({ command, args }),
    log: (message, data) => logs.push({ message, data }),
  };
  return {
    deps,
    spawned,
    logs,
    setMarker: (value: HostUpdateMarker | null) => (marker = value),
    setInstalled: (value: string[]) => (installed = value),
  };
}

/** A controller with a fake poll, plus the messages and label changes it produced. */
function setup(options: Parameters<typeof fakeHost>[0] = {}, hasUI = true) {
  const host = fakeHost(options);
  const notices: { message: string; level: string }[] = [];
  const watches: {
    read: () => HostUpdateStatus | null;
    onSettled: (status: "installed" | "failed") => void;
    stopped: boolean;
  }[] = [];
  const errors: { message: string; data: unknown }[] = [];
  let changes = 0;
  const update = createPiSelfUpdate({
    hostDeps: () => host.deps,
    watch: (watchOptions) => {
      const entry = { ...watchOptions, stopped: false };
      watches.push(entry);
      return () => {
        entry.stopped = true;
      };
    },
    log: (message, data) => errors.push({ message, data }),
  });
  const session: PiUpdateSession = {
    hasUI,
    notify: (message, level) => notices.push({ message, level }),
  };
  const start = () =>
    update.start(session, () => {
      changes++;
    });
  return { host, notices, watches, errors, update, start, changes: () => changes };
}

it("starts the Pi update command in the background when npm has a newer release", async () => {
  const t = setup();
  await t.start();
  expect(t.host.spawned).toHaveLength(1);
  expect(t.host.spawned[0]!.args.slice(-3)).toEqual(["pi", "update", "npm:om-memory-system"]);
  expect(t.host.logs).toEqual([
    {
      message: "Pi plugin self-update",
      data: { code: "started", current: "4.2.0", latest: "4.3.0" },
    },
  ]);
});

it("does not start a second update for the same release within 30 minutes", async () => {
  const t = setup();
  await t.start();
  t.update.stop();
  await t.start();
  expect(t.host.spawned).toHaveLength(1);
});

it("tells the user once that the update is installing, and polls the marker", async () => {
  const t = setup();
  await t.start();
  t.update.stop();
  await t.start();
  expect(t.notices).toEqual([
    { message: "om-memory-system 4.3.0 is installing in the background.", level: "info" },
  ]);
  expect(t.watches).toHaveLength(2);
  expect(t.update.suffix()).toBe("");
});

it("shows the restart suffix and one restart notification when the update installs", async () => {
  const t = setup();
  await t.start();
  t.watches[0]!.onSettled("installed");
  expect(t.update.suffix()).toBe(" · 4.3.0 installed, restart");
  expect(t.changes()).toBe(1);
  expect(t.notices.map((n) => n.message)).toEqual([
    "om-memory-system 4.3.0 is installing in the background.",
    "om-memory-system 4.3.0 installed. Restart Pi to use it.",
  ]);
});

it("shows the available suffix and names the command when the update fails", async () => {
  const t = setup();
  await t.start();
  t.watches[0]!.onSettled("failed");
  expect(t.update.suffix()).toBe(" · 4.3.0 available");
  expect(t.notices.at(-1)!.message).toContain(COMMAND);
  expect(t.notices.at(-1)!.level).toBe("warning");
});

it("reads a finished marker at once, without polling", async () => {
  const done = setup({
    marker: { version: "4.3.0", startedAt: 999_000, outcome: "installed", finishedAt: 999_500 },
  });
  await done.start();
  expect(done.update.suffix()).toBe(" · 4.3.0 installed, restart");
  expect(done.notices.map((n) => n.message)).toEqual([
    "om-memory-system 4.3.0 installed. Restart Pi to use it.",
  ]);
  expect(done.watches).toHaveLength(0);
  expect(done.host.spawned).toHaveLength(0);

  const failed = setup({
    marker: { version: "4.3.0", startedAt: 999_000, outcome: "failed", finishedAt: 999_500 },
  });
  await failed.start();
  expect(failed.update.suffix()).toBe(" · 4.3.0 available");
  expect(failed.notices.map((n) => n.message)).toEqual([expect.stringContaining(COMMAND)]);
});

it("names the command once for a local checkout or a pinned version, and starts nothing", async () => {
  for (const source of ["local", "pinned"] as const) {
    const t = setup({ source });
    await t.start();
    t.update.stop();
    await t.start();
    expect(t.host.spawned).toHaveLength(0);
    expect(t.update.suffix()).toBe(" · 4.3.0 available");
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]!.message).toContain(COMMAND);
  }
});

it("shows an available notice when the update command cannot start", async () => {
  const t = setup();
  t.host.deps.spawnDetached = () => {
    throw new Error("ENOENT");
  };
  await t.start();
  expect(t.host.logs[0]!.data.code).toBe("spawn-failed");
  expect(t.update.suffix()).toBe(" · 4.3.0 available");
  expect(t.notices[0]!.message).toContain(COMMAND);
});

it("shows nothing when OMMS is current, npm is unreachable or the check is off", async () => {
  for (const options of [{ latest: "4.2.0" }, { latest: null }, { enabled: false }]) {
    const t = setup(options);
    await t.start();
    expect(t.update.suffix()).toBe("");
    expect(t.notices).toEqual([]);
    expect(t.host.spawned).toEqual([]);
  }
});

it("still runs the update without a user interface, with no label, notice or poll", async () => {
  const t = setup({}, false);
  await t.start();
  expect(t.host.spawned).toHaveLength(1);
  expect(t.update.suffix()).toBe("");
  expect(t.notices).toEqual([]);
  expect(t.watches).toEqual([]);
  expect(t.changes()).toBe(0);
});

it("stops the poll when the session shuts down", async () => {
  const t = setup();
  await t.start();
  expect(t.watches[0]!.stopped).toBe(false);
  t.update.stop();
  expect(t.watches[0]!.stopped).toBe(true);
});

it("ignores a poll result that arrives after the session shut down", async () => {
  const t = setup();
  await t.start();
  t.update.stop();
  t.watches[0]!.onSettled("installed");
  expect(t.update.suffix()).toBe("");
  expect(t.notices).toHaveLength(1);
});

it("keeps the suffix across sessions and does not tell the user twice", async () => {
  const t = setup();
  await t.start();
  t.watches[0]!.onSettled("installed");
  t.update.stop();
  await t.start();
  expect(t.update.suffix()).toBe(" · 4.3.0 installed, restart");
  expect(t.notices.filter((n) => n.message.includes("Restart Pi"))).toHaveLength(1);
});

it("never throws into the session when the update path fails", async () => {
  const t = setup();
  const broken = createPiSelfUpdate({
    hostDeps: () => {
      throw new Error("secret detail /Users/someone/path");
    },
    log: (message, data) => t.errors.push({ message, data }),
  });
  await broken.start({ hasUI: true, notify: () => {} }, () => {});
  expect(t.errors).toEqual([{ message: "Pi plugin self-update failed", data: { code: "Error" } }]);
});

it("does not fail when a notification or label change throws", async () => {
  const t = setup();
  await t.update.start(
    {
      hasUI: true,
      notify: () => {
        throw new Error("stale context");
      },
    },
    () => {
      throw new Error("stale context");
    }
  );
  t.watches[0]!.onSettled("installed");
  expect(t.update.suffix()).toBe(" · 4.3.0 installed, restart");
  expect(t.errors).toEqual([]);
});

it("builds production inputs for Pi: label, command, marker file and version", () => {
  const deps = piHostSelfUpdateDeps({ env: {} });
  expect(deps.logLabel).toBe("Pi plugin self-update");
  expect(deps.command).toBe("pi");
  expect(deps.args).toEqual(["update", "npm:om-memory-system"]);
  expect(deps.markerPath).toBe(join(homedir(), ".omms", "pi-plugin-update.json"));
  expect(deps.currentVersion).toBe(packageVersion());
  expect(deps.enabled).toBe(true);
});

it("turns the update off with OMMS_DISABLE_UPDATE_CHECK=1", () => {
  expect(piHostSelfUpdateDeps({ env: { OMMS_DISABLE_UPDATE_CHECK: "1" } }).enabled).toBe(false);
});

it("finds the install source from the module path and Pi's settings file", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-pi-self-update-"));
  tempDirs.push(dir);
  const settings = (packages: unknown) =>
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages }));
  const npmPath = "/home/u/.pi/agent/npm/node_modules/om-memory-system/dist/adapters/pi/x.js";
  const sourceFor = (modulePath: string) =>
    piHostSelfUpdateDeps({ env: { PI_CODING_AGENT_DIR: dir }, modulePath }).installSource();

  expect(sourceFor("/work/omms/src/adapters/pi/self-update.ts")).toBe("local");
  expect(sourceFor(npmPath)).toBe("pinned");
  settings(["npm:om-memory-system"]);
  expect(sourceFor(npmPath)).toBe("npm");
  settings(["npm:om-memory-system@4.2.0"]);
  expect(sourceFor(npmPath)).toBe("pinned");
});

it("reads Pi's settings file from ~/.pi/agent when PI_CODING_AGENT_DIR is not set", () => {
  // The default path comes from the home folder, which Bun fixes at process start. A child
  // process with its own temporary home keeps the test away from the real ~/.pi.
  const home = mkdtempSync(join(tmpdir(), "omms-pi-home-"));
  tempDirs.push(home);
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ packages: [{ source: "npm:om-memory-system" }] })
  );
  const module = pathToFileURL(join(import.meta.dir, "../src/adapters/pi/self-update.ts")).href;
  const npmPath = "/home/u/.pi/agent/npm/node_modules/om-memory-system/dist/x.js";
  const script = `
const { piHostSelfUpdateDeps } = await import(${JSON.stringify(module)});
const deps = piHostSelfUpdateDeps({ env: {}, modulePath: ${JSON.stringify(npmPath)} });
console.log("SOURCE:" + deps.installSource());
`;
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.PI_CODING_AGENT_DIR;
  const child = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8" });
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("SOURCE:npm");
});

it("does not run the update again in a later session once it installed", async () => {
  const t = setup();
  await t.start();
  t.watches[0]!.onSettled("installed");
  // Long after the 30-minute de-dup, in the same Pi process with no restart.
  const longAgo = 1_000_000 - 31 * 60 * 1000;
  t.host.setMarker({
    version: "4.3.0",
    startedAt: longAgo,
    outcome: "installed",
    finishedAt: longAgo,
  });
  t.update.stop();
  await t.start();
  expect(t.host.spawned).toHaveLength(1);
  expect(t.update.suffix()).toBe(" · 4.3.0 installed, restart");
});

it("shares one check between sessions that start while it runs", async () => {
  const t = setup();
  let fetches = 0;
  const realFetch = t.host.deps.fetch;
  t.host.deps.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetches++;
    return realFetch(...args);
  }) as typeof fetch;
  const first = t.start();
  t.update.stop();
  await Promise.all([first, t.start()]);
  expect(fetches).toBe(1);
  expect(t.host.spawned).toHaveLength(1);
});

it("treats an installed marker as failed when the new version is not on disk", async () => {
  // The marker says installed, but the Pi package still holds 4.2.0.
  const t = setup({
    marker: { version: "4.3.0", startedAt: 999_000, outcome: "installed", finishedAt: 999_500 },
    installed: ["4.2.0"],
  });
  await t.start();
  expect(t.update.suffix()).toBe(" · 4.3.0 available");
  expect(t.notices.map((n) => n.message)).toEqual([expect.stringContaining(COMMAND)]);
  expect(t.notices[0]!.level).toBe("warning");
  expect(t.watches).toHaveLength(0);
});

it("confirms the install again each time the poll reads the marker", async () => {
  const t = setup();
  await t.start();
  const read = t.watches[0]!.read;
  expect(read()).toBe("pending");
  t.host.setMarker({ version: "4.3.0", startedAt: 1, outcome: "installed", finishedAt: 2 });
  t.host.setInstalled(["4.2.0"]);
  expect(read()).toBe("failed");
  t.host.setInstalled(["4.3.0"]);
  expect(read()).toBe("installed");
});

it("builds production inputs for Pi that read the installed versions from the module path", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-pi-self-update-"));
  tempDirs.push(dir);
  const root = join(dir, "npm", "node_modules", "om-memory-system");
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "om-memory-system", version: "4.3.0" })
  );
  const modulePath = join(root, "dist", "x.js");
  expect(piHostSelfUpdateDeps({ env: {}, modulePath }).installedVersions()).toEqual(["4.3.0"]);
});
