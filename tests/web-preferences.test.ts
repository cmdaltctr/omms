import { beforeEach, describe, expect, it } from "bun:test";
import { readPreference, writePreference } from "../web/src/lib/preferences.js";

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
});

describe("web UI preferences", () => {
  it("reads the omms key when present", () => {
    store.set("omms-theme", "light");
    store.set("opencode-mem-theme", "dark");
    expect(readPreference("omms-theme", "opencode-mem-theme")).toBe("light");
  });

  it("adopts the legacy opencode-mem key once", () => {
    store.set("opencode-mem-lang", "zh");
    expect(readPreference("omms-lang", "opencode-mem-lang")).toBe("zh");
    expect(store.get("omms-lang")).toBe("zh");
    expect(store.get("opencode-mem-lang")).toBe("zh");
  });

  it("still returns the legacy value when copying it to the omms key fails", () => {
    store.set("opencode-mem-theme", "light");
    (globalThis as any).localStorage.setItem = () => {
      throw new Error("quota exceeded");
    };
    expect(readPreference("omms-theme", "opencode-mem-theme")).toBe("light");
  });

  it("returns null when neither key exists", () => {
    expect(readPreference("omms-theme", "opencode-mem-theme")).toBeNull();
  });

  it("survives unavailable storage", () => {
    (globalThis as any).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPreference("omms-theme", "opencode-mem-theme")).toBeNull();
    expect(() => writePreference("omms-theme", "dark")).not.toThrow();
  });
});
