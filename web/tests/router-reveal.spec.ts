import { beforeEach, expect, it, mock } from "bun:test";

const revealed: string[] = [];
mock.module("../src/lib/settings-navigation.ts", () => ({
  revealPageAnchor: (hash: string) => void revealed.push(hash),
}));

const pushed: string[] = [];
const location = { pathname: "/settings", hash: "" };
Object.assign(globalThis, {
  window: {
    location,
    history: {
      pushState: (_: unknown, __: string, url: string) => {
        pushed.push(url);
        const [path, hash = ""] = url.split(/(?=#)/);
        location.pathname = path;
        location.hash = hash;
      },
      replaceState: () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});

const { navigate } = await import("../src/lib/router.ts");

beforeEach(() => {
  revealed.length = 0;
  pushed.length = 0;
});

it("a plain navigation reveals the anchor", () => {
  navigate("/settings#settings-section-log");
  expect(pushed).toEqual(["/settings#settings-section-log"]);
  expect(revealed).toEqual(["#settings-section-log"]);
});

it("a navigation with reveal off adds a history entry and does not reveal", () => {
  navigate("/settings#settings-section-health", false, { reveal: false });
  expect(pushed).toEqual(["/settings#settings-section-health"]);
  expect(revealed).toEqual([]);
});
