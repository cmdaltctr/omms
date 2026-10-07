import { expect, it } from "bun:test";
import {
  SELF_UPDATE_RETRY_MS,
  startPluginSelfUpdate,
  type PluginSelfUpdateDeps,
} from "../src/adapters/claude-code/plugin-self-update.js";

/** A plugin at `plugin` with npm `latest` at `latest`. Nothing touches the real home or Claude. */
function fake(options: {
  plugin?: string | null;
  latest?: string | null;
  enabled?: boolean;
  root?: string | undefined;
  marker?: { version: string; startedAt: number } | null;
  now?: number;
  spawnThrows?: boolean;
}) {
  const spawned: { command: string; args: string[] }[] = [];
  const logs: { message: string; data: Record<string, unknown> }[] = [];
  let marker = options.marker ?? null;
  const deps: PluginSelfUpdateDeps = {
    enabled: options.enabled ?? true,
    pluginRoot: "root" in options ? options.root : "/plugins/omms",
    readPluginVersion: (root) => {
      expect(root).toBe("/plugins/omms");
      if (options.plugin === null) throw new Error("no manifest");
      return options.plugin ?? "4.12.0";
    },
    fetch: (async () => {
      if (options.latest === null) throw new Error("offline");
      return new Response(JSON.stringify({ version: options.latest ?? "4.13.0" }), { status: 200 });
    }) as unknown as typeof fetch,
    now: () => options.now ?? 1_000_000,
    readMarker: () => marker,
    writeMarker: (value) => {
      marker = value;
    },
    spawnDetached: (command, args) => {
      if (options.spawnThrows) throw new Error("ENOENT");
      spawned.push({ command, args });
    },
    log: (message, data) => logs.push({ message, data }),
  };
  return { deps, spawned, logs, marker: () => marker };
}

it("starts a background plugin update when npm has a newer release", async () => {
  const f = fake({});
  expect(await startPluginSelfUpdate(f.deps)).toBe("started");
  expect(f.spawned).toHaveLength(1);
  const script = f.spawned[0]!.args.join(" ");
  expect(script).toContain('["plugin", "marketplace", "update", "omms"]');
  expect(script).toContain('["plugin", "update", "omms@omms"]');
  expect(f.marker()).toEqual({ version: "4.13.0", startedAt: 1_000_000 });
  expect(f.logs).toEqual([
    {
      message: "Claude plugin self-update",
      data: { code: "started", plugin: "4.12.0", latest: "4.13.0" },
    },
  ]);
});

it("does nothing when the plugin is on npm latest", async () => {
  const f = fake({ plugin: "4.13.0" });
  expect(await startPluginSelfUpdate(f.deps)).toBe("current");
  expect(f.spawned).toEqual([]);
});

it("does not start a second update for the same release within the retry window", async () => {
  const f = fake({ marker: { version: "4.13.0", startedAt: 1_000_000 - 60_000 } });
  expect(await startPluginSelfUpdate(f.deps)).toBe("recent");
  expect(f.spawned).toEqual([]);
});

it("tries again after the retry window", async () => {
  const f = fake({
    marker: { version: "4.13.0", startedAt: 1_000_000 - SELF_UPDATE_RETRY_MS - 1 },
  });
  expect(await startPluginSelfUpdate(f.deps)).toBe("started");
});

it("starts at once for a release newer than the one it last tried", async () => {
  const f = fake({ latest: "4.14.0", marker: { version: "4.13.0", startedAt: 1_000_000 } });
  expect(await startPluginSelfUpdate(f.deps)).toBe("started");
});

it("sends no request when the update check is turned off", async () => {
  const f = fake({ enabled: false });
  expect(await startPluginSelfUpdate(f.deps)).toBe("disabled");
  expect(f.spawned).toEqual([]);
});

it("does nothing outside a Claude plugin", async () => {
  const f = fake({ root: undefined });
  expect(await startPluginSelfUpdate(f.deps)).toBe("no-plugin");
});

it("keeps quiet when npm cannot be reached", async () => {
  const f = fake({ latest: null });
  expect(await startPluginSelfUpdate(f.deps)).toBe("unreachable");
  expect(f.spawned).toEqual([]);
});

it("ignores a prerelease on npm", async () => {
  const f = fake({ latest: "5.0.0-beta.1" });
  expect(await startPluginSelfUpdate(f.deps)).toBe("current");
});

it("reports a failed start without throwing", async () => {
  const f = fake({ spawnThrows: true });
  expect(await startPluginSelfUpdate(f.deps)).toBe("spawn-failed");
});
