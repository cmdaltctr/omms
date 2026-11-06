import { beforeEach, expect, it, mock } from "bun:test";
import { installReact, resetRender, settle, text } from "./space-kit.tsx";

installReact();
let status: Record<string, unknown> = {};
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => status,
}));
const { useSpaceReload } = await import("../src/hooks/useSpaceReload.ts");
const { refreshWebStatus } = await import("../src/lib/web-status.ts");

const calls: string[] = [];
const explorer = {
  loadTags: async () => void calls.push("tags"),
  loadStats: async () => void calls.push("stats"),
  checkMigrationStatus: async () => void calls.push("migration"),
  onTagFilterChange: (tag: string) => void calls.push(`filter:${JSON.stringify(tag)}`),
};
let loaded: unknown = { name: "profile" };
const profile = {
  get userProfile() {
    return loaded as never;
  },
  loadUserProfile: async () => void calls.push("profile"),
};
function Probe() {
  return <span>{useSpaceReload(explorer, profile)}</span>;
}
const epoch = async () => text((await settle(<Probe />, [Probe]))[0]!.props.children);
const publish = async (id: string) => {
  status = {
    version: "1",
    canControl: true,
    activeSpace: { id, name: id, customStoragePath: false },
  };
  await refreshWebStatus();
};

beforeEach(() => {
  resetRender();
  calls.length = 0;
  loaded = { name: "profile" };
});

it("only records the first space it sees", async () => {
  await publish("default");
  expect(await epoch()).toBe("0");
  expect(calls).toEqual([]);
});

it("reloads the memories, tags, stats and profile when the active space changes", async () => {
  await publish("default");
  await epoch();
  await publish("experiments");
  expect(await epoch()).toBe("1");
  expect(calls.sort()).toEqual(['filter:""', "migration", "profile", "stats", "tags"].sort());
  // The same space on the next status call changes nothing.
  calls.length = 0;
  await publish("experiments");
  expect(await epoch()).toBe("1");
  expect(calls).toEqual([]);
});

it("skips the profile when the page never loaded it", async () => {
  loaded = null;
  await publish("default");
  await epoch();
  await publish("experiments");
  await epoch();
  expect(calls).not.toContain("profile");
});
