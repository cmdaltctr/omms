import { describe, expect, it, mock } from "bun:test";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { applyToNewestProfile } = await import("../src/services/user-profile/profile-edit-save.js");

type Data = { preferences: any[]; patterns: any[]; workflows: any[] };

function dataOf(...descriptions: string[]): Data {
  return {
    preferences: descriptions.map((description) => ({ category: "c", description })),
    patterns: [],
    workflows: [],
  };
}

/** A store whose active profile can change between calls, and whose saves can be refused. */
function fakeStore(initial: { version: number; data: Data }, refuse = 0) {
  let current = initial;
  let refused = 0;
  const saves: Array<{ version: number; data: Data }> = [];
  return {
    saves,
    set(next: { version: number; data: Data }) {
      current = next;
    },
    async getActiveProfile() {
      return { id: "p1", version: current.version, profileData: JSON.stringify(current.data) };
    },
    async updateProfile(
      _id: string,
      data: Data,
      _prompts: number,
      _summary: string,
      expectedVersion: number
    ) {
      if (refused < refuse) {
        refused++;
        return false;
      }
      if (expectedVersion !== current.version) return false;
      saves.push({ version: expectedVersion, data });
      current = { version: expectedVersion + 1, data };
      return true;
    },
  };
}

const drop = (data: Data) => ({
  profile: { ...data, preferences: data.preferences.slice(1) },
  changed: true,
  result: data.preferences.length,
});

describe("applyToNewestProfile", () => {
  it("saves the edited profile with the version it read", async () => {
    const store = fakeStore({ version: 4, data: dataOf("a", "b") });
    const out = await applyToNewestProfile("u", drop, { summary: "s", store: store as never });
    expect(out).toEqual({ status: "saved", result: 2 });
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]!.version).toBe(4);
    expect(store.saves[0]!.data.preferences.map((p) => p.description)).toEqual(["b"]);
  });

  it("does not save when the edit changed nothing", async () => {
    const store = fakeStore({ version: 1, data: dataOf("a") });
    const out = await applyToNewestProfile(
      "u",
      (data) => ({ profile: data, changed: false, result: "none" }),
      { summary: "s", store: store as never }
    );
    expect(out).toEqual({ status: "unchanged", result: "none" });
    expect(store.saves).toHaveLength(0);
  });

  it("loads the newer profile and edits it again after a conflict", async () => {
    const store = fakeStore({ version: 1, data: dataOf("a", "b") }, 1);
    const seen: string[][] = [];
    const out = await applyToNewestProfile(
      "u",
      (data: Data) => {
        seen.push(data.preferences.map((p) => p.description));
        if (seen.length === 1) store.set({ version: 2, data: dataOf("a", "b", "learnt") });
        return drop(data);
      },
      { summary: "s", store: store as never }
    );
    expect(out.status).toBe("saved");
    expect(seen).toEqual([
      ["a", "b"],
      ["a", "b", "learnt"],
    ]);
    expect(store.saves[0]!.data.preferences.map((p) => p.description)).toEqual(["b", "learnt"]);
  });

  it("gives up after three conflicts and saves nothing", async () => {
    const store = fakeStore({ version: 1, data: dataOf("a") }, 99);
    let edits = 0;
    const out = await applyToNewestProfile(
      "u",
      (data: Data) => {
        edits++;
        return drop(data);
      },
      { summary: "s", store: store as never }
    );
    expect(out).toEqual({ status: "conflict" });
    expect(edits).toBe(3);
    expect(store.saves).toHaveLength(0);
  });

  it("reports no profile and does not edit", async () => {
    let edits = 0;
    const out = await applyToNewestProfile(
      "u",
      (data: Data) => {
        edits++;
        return drop(data);
      },
      {
        summary: "s",
        store: { getActiveProfile: async () => null, updateProfile: async () => true } as never,
      }
    );
    expect(out).toEqual({ status: "no-profile" });
    expect(edits).toBe(0);
  });

  it("runs beforeSave before each save and its undo only for attempts that did not save", async () => {
    const store = fakeStore({ version: 1, data: dataOf("a", "b") }, 1);
    const events: string[] = [];
    const out = await applyToNewestProfile("u", drop, {
      summary: "s",
      store: store as never,
      beforeSave: async () => {
        events.push("before");
        return async () => {
          events.push("undo");
        };
      },
    });
    expect(out.status).toBe("saved");
    expect(events).toEqual(["before", "undo", "before"]);
  });

  it("runs beforeSave's undo after the last failed attempt", async () => {
    const store = fakeStore({ version: 1, data: dataOf("a") }, 99);
    const events: string[] = [];
    await applyToNewestProfile("u", drop, {
      summary: "s",
      store: store as never,
      beforeSave: async () => {
        events.push("before");
        return async () => {
          events.push("undo");
        };
      },
    });
    expect(events).toEqual(["before", "undo", "before", "undo", "before", "undo"]);
  });

  it("does not run beforeSave when nothing changed", async () => {
    const store = fakeStore({ version: 1, data: dataOf("a") });
    let called = false;
    await applyToNewestProfile("u", (data) => ({ profile: data, changed: false, result: 0 }), {
      summary: "s",
      store: store as never,
      beforeSave: async () => {
        called = true;
      },
    });
    expect(called).toBe(false);
  });

  it("gives the edit and beforeSave the profile record it loaded", async () => {
    const store = fakeStore({ version: 7, data: dataOf("a", "b") });
    const seen: Array<[string, number]> = [];
    await applyToNewestProfile(
      "u",
      (data: Data, profile: { id: string; version: number }) => {
        seen.push([profile.id, profile.version]);
        return drop(data);
      },
      {
        summary: "s",
        store: store as never,
        beforeSave: async (_result: number, profile: { id: string; version: number }) => {
          seen.push([profile.id, profile.version]);
        },
      }
    );
    expect(seen).toEqual([
      ["p1", 7],
      ["p1", 7],
    ]);
  });

  it("lets an error from the edit reach the caller", async () => {
    const store = fakeStore({ version: 1, data: dataOf("a") });
    await expect(
      applyToNewestProfile(
        "u",
        () => {
          throw new Error("boom");
        },
        { summary: "s", store: store as never }
      )
    ).rejects.toThrow("boom");
  });
});
