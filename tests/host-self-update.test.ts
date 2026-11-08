import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOST_SELF_UPDATE_RETRY_MS,
  confirmedStatus,
  hostSelfUpdateDeps,
  hostUpdateRunnerArgs,
  hostUpdateStatus,
  installedFromNpm,
  markerStatus,
  readMarkerFile,
  startHostSelfUpdate,
  unpinnedCacheFolder,
  unpinnedPackageSource,
  updateNotice,
  updateSuffix,
  watchHostUpdate,
  type HostSelfUpdateDeps,
  type HostUpdateMarker,
} from "../src/services/host-self-update.js";

/** A host at `current` with npm `latest` at `latest`. Nothing touches the real home or a host. */
function fake(options: {
  current?: string;
  latest?: string | null;
  enabled?: boolean;
  source?: "npm" | "local" | "pinned";
  marker?: HostUpdateMarker | null;
  now?: number;
  spawnThrows?: boolean;
  /** The versions found on disk. Defaults to the new release being there. */
  installed?: string[];
}) {
  const spawned: { command: string; args: string[] }[] = [];
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  let fetches = 0;
  let marker = options.marker ?? null;
  const deps: HostSelfUpdateDeps = {
    enabled: options.enabled ?? true,
    logLabel: "Test plugin self-update",
    currentVersion: options.current ?? "4.2.0",
    command: "testhost",
    args: ["update", "om-memory-system"],
    markerPath: "/fake/.omms/test-plugin-update.json",
    installSource: () => options.source ?? "npm",
    fetch: (async () => {
      fetches++;
      if (options.latest === null) throw new Error("offline");
      return new Response(JSON.stringify({ version: options.latest ?? "4.3.0" }), { status: 200 });
    }) as unknown as typeof fetch,
    now: () => options.now ?? 1_000_000,
    readMarker: () => marker,
    writeMarker: (value) => {
      marker = value;
    },
    installedVersions: () => options.installed ?? ["4.3.0"],
    spawnDetached: (command, args) => {
      if (options.spawnThrows) throw new Error("ENOENT");
      spawned.push({ command, args });
    },
    log: (message, data) => logs.push({ message, data }),
  };
  return { deps, spawned, logs, marker: () => marker, fetches: () => fetches };
}

it("starts a background host update when npm has a newer release", async () => {
  const f = fake({});
  expect(await startHostSelfUpdate(f.deps)).toEqual({ code: "started", update: "4.3.0" });
  expect(f.spawned).toHaveLength(1);
  expect(f.spawned[0]!.args.join(" ")).toContain("testhost");
  expect(f.marker()).toEqual({ version: "4.3.0", startedAt: 1_000_000 });
  expect(f.logs).toEqual([
    {
      message: "Test plugin self-update",
      data: { code: "started", current: "4.2.0", latest: "4.3.0" },
    },
  ]);
});

it("does nothing and asks no one when the check is turned off", async () => {
  const f = fake({ enabled: false });
  expect(await startHostSelfUpdate(f.deps)).toEqual({ code: "disabled", update: null });
  expect(f.fetches()).toBe(0);
  expect(f.spawned).toHaveLength(0);
  expect(f.logs).toHaveLength(0);
});

it("does nothing when the running version is current", async () => {
  const f = fake({ current: "4.3.0", latest: "4.3.0" });
  expect(await startHostSelfUpdate(f.deps)).toEqual({ code: "current", update: null });
  expect(f.spawned).toHaveLength(0);
  expect(f.marker()).toBeNull();
});

it("ignores a prerelease on npm", async () => {
  const f = fake({ latest: "4.4.0-beta.1" });
  expect(await startHostSelfUpdate(f.deps)).toEqual({ code: "current", update: null });
  expect(f.spawned).toHaveLength(0);
});

it("does nothing when npm cannot be reached", async () => {
  const f = fake({ latest: null });
  expect(await startHostSelfUpdate(f.deps)).toEqual({ code: "unreachable", update: null });
  expect(f.spawned).toHaveLength(0);
  expect(f.logs).toHaveLength(0);
});

it("does not start a second update for the same release within 30 minutes", async () => {
  const f = fake({
    marker: { version: "4.3.0", startedAt: 1_000_000 - HOST_SELF_UPDATE_RETRY_MS + 1 },
  });
  expect(await startHostSelfUpdate(f.deps)).toEqual({ code: "recent", update: "4.3.0" });
  expect(f.spawned).toHaveLength(0);
});

it("starts again after 30 minutes, or for a different release", async () => {
  const old = fake({
    marker: { version: "4.3.0", startedAt: 1_000_000 - HOST_SELF_UPDATE_RETRY_MS - 1 },
  });
  expect((await startHostSelfUpdate(old.deps)).code).toBe("started");
  const other = fake({ marker: { version: "4.2.5", startedAt: 1_000_000 } });
  expect((await startHostSelfUpdate(other.deps)).code).toBe("started");
});

it("logs spawn-failed and keeps the marker when the update cannot start", async () => {
  const f = fake({ spawnThrows: true });
  expect(await startHostSelfUpdate(f.deps)).toEqual({ code: "spawn-failed", update: "4.3.0" });
  expect(f.marker()).toEqual({ version: "4.3.0", startedAt: 1_000_000 });
  expect(f.logs).toEqual([
    {
      message: "Test plugin self-update",
      data: { code: "spawn-failed", current: "4.2.0", latest: "4.3.0" },
    },
  ]);
});

it("skips a local checkout and a pinned install but still reports the release", async () => {
  for (const source of ["local", "pinned"] as const) {
    const f = fake({ source });
    expect(await startHostSelfUpdate(f.deps)).toEqual({ code: source, update: "4.3.0" });
    expect(f.spawned).toHaveLength(0);
    expect(f.marker()).toBeNull();
    expect(f.logs).toHaveLength(0);
  }
});

it("reads a marker as pending, installed or failed for one release", () => {
  expect(markerStatus(null, "4.3.0")).toBeNull();
  expect(markerStatus({ version: "4.2.5", startedAt: 1 }, "4.3.0")).toBeNull();
  expect(markerStatus({ version: "4.3.0", startedAt: 1 }, "4.3.0")).toBe("pending");
  expect(
    markerStatus({ version: "4.3.0", startedAt: 1, outcome: "installed", finishedAt: 2 }, "4.3.0")
  ).toBe("installed");
  expect(
    markerStatus({ version: "4.3.0", startedAt: 1, outcome: "failed", finishedAt: 2 }, "4.3.0")
  ).toBe("failed");
});

it("treats a missing or unreadable marker file as no marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-host-update-"));
  expect(readMarkerFile(join(dir, "missing.json"))).toBeNull();
  writeFileSync(join(dir, "bad.json"), "{not json");
  expect(readMarkerFile(join(dir, "bad.json"))).toBeNull();
  writeFileSync(join(dir, "wrong.json"), JSON.stringify({ version: 4, startedAt: "x" }));
  expect(readMarkerFile(join(dir, "wrong.json"))).toBeNull();
  writeFileSync(
    join(dir, "odd-outcome.json"),
    JSON.stringify({ version: "4.3.0", startedAt: 1, outcome: "maybe" })
  );
  expect(readMarkerFile(join(dir, "odd-outcome.json"))).toEqual({
    version: "4.3.0",
    startedAt: 1,
  });
});

it("the detached script runs the host command and records the outcome", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-host-update-"));
  for (const [exitCode, outcome] of [
    [0, "installed"],
    [3, "failed"],
  ] as const) {
    const markerPath = join(dir, `marker-${exitCode}.json`);
    const marker = { version: "4.3.0", startedAt: 5 };
    writeFileSync(markerPath, JSON.stringify(marker));
    const run = spawnSync(
      process.execPath,
      hostUpdateRunnerArgs(markerPath, marker, process.execPath, [
        "-e",
        `process.exit(${exitCode})`,
      ]),
      { timeout: 30_000, env: { ...process.env, BUN_BE_BUN: "1" } }
    );
    expect(run.status).toBe(0);
    const written = JSON.parse(readFileSync(markerPath, "utf8")) as HostUpdateMarker;
    expect(written.version).toBe("4.3.0");
    expect(written.startedAt).toBe(5);
    expect(written.outcome).toBe(outcome);
    expect(typeof written.finishedAt).toBe("number");
  }
});

it("the detached script records a failure when the host command does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-host-update-"));
  const markerPath = join(dir, "marker.json");
  const marker = { version: "4.3.0", startedAt: 5 };
  spawnSync(
    process.execPath,
    hostUpdateRunnerArgs(markerPath, marker, "omms-no-such-host-command", ["update"]),
    { timeout: 30_000 }
  );
  expect(readMarkerFile(markerPath)?.outcome).toBe("failed");
});

it("knows an npm install from a local checkout by the module path", () => {
  expect(
    installedFromNpm(
      "/home/u/.pi/agent/npm/node_modules/om-memory-system/dist/adapters/pi/extension.js"
    )
  ).toBe(true);
  expect(
    installedFromNpm(
      "C:\\Users\\u\\.cache\\opencode\\npm\\om-memory-system@latest\\node_modules\\om-memory-system\\dist\\x.js"
    )
  ).toBe(true);
  expect(installedFromNpm("/home/u/dev/omms/dist/adapters/pi/extension.js")).toBe(false);
  expect(installedFromNpm("/home/u/node_modules/om-memory-system-fork/dist/x.js")).toBe(false);
});

it("treats an OpenCode cache folder as unpinned only for latest or no version", () => {
  const path = (folder: string) =>
    `/home/u/.cache/opencode/npm/${folder}/node_modules/om-memory-system/dist/adapters/opencode/tui-status.js`;
  expect(unpinnedCacheFolder(path("om-memory-system@latest"))).toBe(true);
  expect(unpinnedCacheFolder(path("om-memory-system"))).toBe(true);
  expect(unpinnedCacheFolder(path("om-memory-system@4.2.0"))).toBe(false);
  expect(unpinnedCacheFolder(path("om-memory-system@^4"))).toBe(false);
  // OpenCode 2.2 puts a timestamp folder between the spec folder and node_modules.
  expect(unpinnedCacheFolder(path("om-memory-system@latest/1794091868583"))).toBe(true);
  expect(unpinnedCacheFolder(path("om-memory-system@4.2.0/1794091868583"))).toBe(false);
  expect(unpinnedCacheFolder(path("other@latest/1794091868583"))).toBe(false);
  expect(unpinnedCacheFolder("/home/u/.config/opencode/node_modules/om-memory-system/x.js")).toBe(
    false
  );
  expect(unpinnedCacheFolder("/home/u/dev/omms/dist/x.js")).toBe(false);
});

it("treats a Pi package entry as unpinned only without a version", () => {
  const settings = (packages: unknown) => JSON.stringify({ packages });
  expect(unpinnedPackageSource(settings(["npm:om-memory-system", "npm:other"]))).toBe(true);
  expect(unpinnedPackageSource(settings([{ source: "npm:om-memory-system" }]))).toBe(true);
  expect(unpinnedPackageSource(settings(["npm:om-memory-system@4.2.0"]))).toBe(false);
  expect(unpinnedPackageSource(settings([{ source: "npm:om-memory-system@latest" }]))).toBe(false);
  expect(unpinnedPackageSource(settings(["npm:other"]))).toBe(false);
  expect(unpinnedPackageSource(settings("npm:om-memory-system"))).toBe(false);
  expect(unpinnedPackageSource("{not json")).toBe(false);
  expect(unpinnedPackageSource(null)).toBe(false);
});

it("words the footer suffix and the one-time notices for each state", () => {
  expect(updateSuffix("4.3.0", "available")).toBe(" · 4.3.0 available");
  expect(updateSuffix("4.3.0", "installed")).toBe(" · 4.3.0 installed, restart");
  const notice = (state: Parameters<typeof updateNotice>[0]["state"]) =>
    updateNotice({
      hostName: "Pi",
      command: "pi update npm:om-memory-system",
      current: "4.2.0",
      update: "4.3.0",
      state,
    });
  expect(notice("available")).toBe(
    "om-memory-system 4.3.0 is available (running 4.2.0). Run: pi update npm:om-memory-system, then restart Pi."
  );
  expect(notice("installing")).toBe("om-memory-system 4.3.0 is installing in the background.");
  expect(notice("installed")).toBe("om-memory-system 4.3.0 installed. Restart Pi to use it.");
  const service = (state: "available" | "installed") =>
    updateNotice({
      hostName: "OpenCode",
      command: "opencode plugin update om-memory-system",
      restart: "restart OpenCode and run opencode service restart",
      current: "4.2.0",
      update: "4.3.0",
      state,
    });
  expect(service("installed")).toBe(
    "om-memory-system 4.3.0 installed. Restart OpenCode and run opencode service restart to use it."
  );
  expect(service("available")).toBe(
    "om-memory-system 4.3.0 is available (running 4.2.0). Run: opencode plugin update om-memory-system, then restart OpenCode and run opencode service restart."
  );
});

it("watches the marker every interval until it settles, for at most the limit", async () => {
  let status: "pending" | "installed" | "failed" | null = "pending";
  let reads = 0;
  const settled: string[] = [];
  const stop = watchHostUpdate({
    read: () => {
      reads++;
      return status;
    },
    onSettled: (value) => settled.push(value),
    intervalMs: 5,
    maxMs: 1_000,
  });
  expect(reads).toBe(1);
  await Bun.sleep(12);
  status = "installed";
  await Bun.sleep(15);
  const readsAtSettle = reads;
  await Bun.sleep(15);
  expect(settled).toEqual(["installed"]);
  expect(reads).toBe(readsAtSettle);
  stop();
});

it("settles at once when the marker already holds an outcome", () => {
  const settled: string[] = [];
  watchHostUpdate({
    read: () => "failed",
    onSettled: (value) => settled.push(value),
    intervalMs: 5,
    maxMs: 1_000,
  });
  expect(settled).toEqual(["failed"]);
});

it("stops watching after the limit and on stop", async () => {
  let reads = 0;
  watchHostUpdate({
    read: () => {
      reads++;
      return "pending";
    },
    onSettled: () => {},
    intervalMs: 5,
    maxMs: 12,
  });
  await Bun.sleep(40);
  const afterLimit = reads;
  await Bun.sleep(20);
  expect(reads).toBe(afterLimit);

  let stoppedReads = 0;
  const stop = watchHostUpdate({
    read: () => {
      stoppedReads++;
      return "pending";
    },
    onSettled: () => {},
    intervalMs: 5,
    maxMs: 1_000,
  });
  stop();
  await Bun.sleep(20);
  expect(stoppedReads).toBe(1);
});

it("confirms an installed outcome only when a copy holds the new version", () => {
  expect(confirmedStatus("installed", "4.3.0", ["4.2.0", "4.3.0"])).toBe("installed");
  expect(confirmedStatus("installed", "4.3.0", ["4.2.0"])).toBe("failed");
  expect(confirmedStatus("installed", "4.3.0", [])).toBe("failed");
  // A release that landed during the update still satisfies it.
  expect(confirmedStatus("installed", "4.3.0", ["4.3.1"])).toBe("installed");
  // The other states pass through unchanged.
  expect(confirmedStatus("pending", "4.3.0", [])).toBe("pending");
  expect(confirmedStatus("failed", "4.3.0", ["4.3.0"])).toBe("failed");
  expect(confirmedStatus(null, "4.3.0", ["4.3.0"])).toBeNull();
});

it("reads the marker and the installed copies together", () => {
  const done = (outcome?: "installed" | "failed"): HostUpdateMarker => ({
    version: "4.3.0",
    startedAt: 1,
    ...(outcome ? { outcome, finishedAt: 2 } : {}),
  });
  expect(hostUpdateStatus(fake({ marker: done("installed") }).deps, "4.3.0")).toBe("installed");
  expect(
    hostUpdateStatus(fake({ marker: done("installed"), installed: ["4.2.0"] }).deps, "4.3.0")
  ).toBe("failed");
  expect(hostUpdateStatus(fake({ marker: done(), installed: [] }).deps, "4.3.0")).toBe("pending");
  expect(hostUpdateStatus(fake({ marker: null }).deps, "4.3.0")).toBeNull();
});

it("builds production inputs that list the versions on disk from the module path", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-host-update-"));
  const root = join(dir, "node_modules", "om-memory-system");
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "om-memory-system", version: "4.3.0" })
  );
  const deps = hostSelfUpdateDeps({
    logLabel: "Test plugin self-update",
    currentVersion: "4.2.0",
    command: "testhost",
    args: [],
    markerPath: join(dir, "marker.json"),
    modulePath: join(root, "dist", "plugin.js"),
    installSource: () => "npm",
    log: () => {},
    env: {},
  });
  expect(deps.installedVersions()).toEqual(["4.3.0"]);
});
