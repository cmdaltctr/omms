import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { migrateView, readView } from "../src/lib/components/paged-list/paging.ts";
import { initialView } from "../src/lib/components/paged-list/use-paging.ts";
import {
  LEGACY_LIST_KEY,
  PENDING_LIST_KEY,
  ProposalList,
  RECENT_LIST_KEY,
  SKILL_PROPOSALS_LIST_KEY,
} from "../src/lib/components/skills/ProposalList.tsx";
import type { Proposal } from "../src/lib/skills-api.ts";
import { PROPOSAL_SORTS } from "../src/lib/skills-sorts.ts";

const g = globalThis as { localStorage?: unknown };
afterEach(() => {
  delete g.localStorage;
});

/** A fake storage that records every write and removal. */
function fakeStorage(initial: Record<string, unknown>) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes: string[] = [];
  const removals: string[] = [];
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k);
      store.set(k, v);
    },
    removeItem: (k: string) => {
      removals.push(k);
      store.delete(k);
    },
  };
  return { store, writes, removals };
}

const OLD = "omms-list-old";
const NEW = "omms-list-new-v2";

describe("migrateView", () => {
  it("copies a custom size, the sort and the order to the new key", () => {
    const { writes } = fakeStorage({ [OLD]: { perPage: 10, sort: "oldest", order: "asc" } });
    migrateView(NEW, OLD);
    expect(readView(NEW)).toEqual({ perPage: 10, sort: "oldest", order: "asc" });
    expect(writes).toEqual([NEW]);
    expect(initialView(NEW, PROPOSAL_SORTS, 3).perPage).toBe(10);
  });

  it("leaves out a size of 5, which cannot be told from the old default", () => {
    fakeStorage({ [OLD]: { perPage: 5, sort: "state", order: "asc" } });
    migrateView(NEW, OLD);
    expect(readView(NEW)?.perPage).toBeUndefined();
    expect(readView(NEW)?.sort).toBe("state");
    expect(initialView(NEW, PROPOSAL_SORTS, 3).perPage).toBe(3);
  });

  it("keeps the sort of an old entry that holds no size", () => {
    fakeStorage({ [OLD]: { sort: "skill", order: "desc" } });
    migrateView(NEW, OLD);
    expect(initialView(NEW, PROPOSAL_SORTS, 3)).toEqual({
      perPage: 3,
      sort: "skill",
      order: "desc",
    });
  });

  it("ignores the old key once the new key holds an entry", () => {
    const { writes } = fakeStorage({
      [OLD]: { perPage: 10, sort: "oldest", order: "asc" },
      [NEW]: { sort: "newest", order: "desc" },
    });
    migrateView(NEW, OLD);
    expect(writes).toEqual([]);
    expect(initialView(NEW, PROPOSAL_SORTS, 3).perPage).toBe(3);
  });

  it("writes nothing when there is no old entry or it holds nothing to carry", () => {
    const { writes } = fakeStorage({ [OLD]: { perPage: 5 } });
    migrateView(NEW, OLD);
    migrateView(NEW, "omms-list-missing");
    expect(writes).toEqual([]);
  });

  it("never removes or rewrites the old key", () => {
    const { store, writes, removals } = fakeStorage({ [OLD]: { perPage: 10 } });
    const before = store.get(OLD);
    migrateView(NEW, OLD);
    expect(removals).toEqual([]);
    expect(writes).not.toContain(OLD);
    expect(store.get(OLD)).toBe(before);
  });

  it("does not throw when storage is blocked", () => {
    g.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => migrateView(NEW, OLD)).not.toThrow();
    expect(initialView(NEW, PROPOSAL_SORTS, 3).perPage).toBe(3);
  });
});

const proposal = (n: number): Proposal => ({
  id: `p${n}`,
  kind: "improve",
  skillName: `skill-${n}`,
  skillPath: `/skills/skill-${n}/SKILL.md`,
  content: "new",
  diff: null,
  summary: "s",
  evidenceTurnIds: [],
  state: "pending",
  appliedBy: null,
  createdAt: n,
  updatedAt: n,
});
const articles = (html: string) => (html.match(/<article/g) ?? []).length;

describe("the three proposal lists carry a saved size over from the old keys", () => {
  const lists = [
    [PENDING_LIST_KEY, "omms-list-pending"],
    [RECENT_LIST_KEY, "omms-list-recent"],
    [SKILL_PROPOSALS_LIST_KEY, "omms-list-skill-proposals"],
  ] as const;

  it("maps each versioned key to its old key", () => {
    expect(Object.entries(LEGACY_LIST_KEY).sort()).toEqual(
      lists.map(([key, old]) => [key, old]).sort()
    );
  });

  for (const [key, old] of lists) {
    it(`shows 10 on ${key} when ${old} saved 10, and 3 when it saved 5`, () => {
      const items = Array.from({ length: 12 }, (_, n) => proposal(n));
      const render = () =>
        renderToStaticMarkup(
          <ProposalList storageKey={key} proposals={items} onChange={() => {}} />
        );
      const { store } = fakeStorage({ [old]: { perPage: 10, sort: "newest", order: "desc" } });
      expect(articles(render())).toBe(10);
      expect(store.has(old)).toBe(true);
      fakeStorage({ [old]: { perPage: 5, sort: "newest", order: "desc" } });
      expect(articles(render())).toBe(3);
    });
  }
});
