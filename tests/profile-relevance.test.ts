import { describe, expect, it } from "bun:test";
import {
  cosineSimilarity,
  selectProfileItems,
} from "../src/services/user-profile/profile-relevance.js";

interface Item {
  name: string;
  category?: string;
  anchor?: number[];
  centroid?: number[];
}

// Axis 0 is "packages", axis 1 is "testing", axis 2 is "style".
const PACKAGES = [1, 0, 0];
const item = (name: string, vector?: number[], category = name): Item => ({
  name,
  category,
  anchor: vector,
});
const names = (items: Item[]) => items.map((entry) => entry.name);

// Today's order puts a, b, c, d first; the packages item sits far down.
const candidates: Item[] = [
  item("a", [0, 0, 1]),
  item("b", [0, 1, 0]),
  item("c", [0, 0.9, 0.1]),
  item("d", [0.1, 0, 1]),
  item("e", [0, 0.5, 0.5]),
  item("pm", [1, 0.05, 0]),
  item("pm2", [0.9, 0.1, 0]),
];
const baseline = candidates.slice(0, 4);

const select = (overrides: Partial<Parameters<typeof selectProfileItems<Item>>[0]> = {}) =>
  selectProfileItems<Item>({
    baseline,
    candidates,
    count: 4,
    queryVector: PACKAGES,
    minCloseness: 0.5,
    onePerCategory: true,
    ...overrides,
  });

describe("cosineSimilarity", () => {
  it("is 1 for equal directions, 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("is 0 for different lengths and for a zero vector", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe("selectProfileItems", () => {
  it("fills half the slots, rounded up, with the closest items", () => {
    const result = select();
    expect(result.relevanceSlots).toBe(2);
    expect(names(result.items.slice(0, 2))).toEqual(["pm", "pm2"]);
  });

  it("fills the other slots in the existing order and keeps the count", () => {
    const result = select();
    expect(names(result.items)).toEqual(["pm", "pm2", "a", "b"]);
    expect(result.items).toHaveLength(4);
  });

  it("rounds up for an odd count", () => {
    const result = select({ count: 3, baseline: candidates.slice(0, 3) });
    expect(result.relevanceSlots).toBe(2);
    expect(result.items).toHaveLength(3);
  });

  it("keeps one item per category when asked", () => {
    const sameCategory = [
      item("pm", [1, 0, 0], "tooling"),
      item("pm2", [0.9, 0.1, 0], "tooling"),
      ...candidates.slice(0, 4),
    ];
    const result = select({ candidates: sameCategory, baseline: sameCategory.slice(2) });
    expect(names(result.items).filter((name) => name.startsWith("pm"))).toEqual(["pm"]);
    expect(result.items).toHaveLength(4);
  });

  it("allows repeated categories when the section has none", () => {
    const sameCategory = [item("pm", [1, 0, 0], "x"), item("pm2", [0.9, 0.1, 0], "x"), ...baseline];
    const result = select({
      candidates: sameCategory,
      baseline,
      onePerCategory: false,
    });
    expect(names(result.items.slice(0, 2))).toEqual(["pm", "pm2"]);
  });

  it("skips an item without vectors for relevance but keeps it in the existing order", () => {
    const withoutVectors = [item("novec"), ...candidates];
    const result = select({
      candidates: withoutVectors,
      baseline: [item("novec"), ...baseline.slice(0, 3)],
    });
    expect(names(result.items)).toContain("novec");
    expect(names(result.items.slice(0, 2))).toEqual(["pm", "pm2"]);
  });

  it("uses the centroid when an item has no anchor", () => {
    const centroidOnly: Item = { name: "cen", category: "cen", centroid: [1, 0, 0] };
    const result = select({ candidates: [centroidOnly, ...candidates], baseline });
    expect(result.items[0]?.name).toBe("cen");
  });

  it("gives nothing a relevance slot below the minimum closeness", () => {
    const result = select({ queryVector: [0, 0, 1], minCloseness: 0.999, candidates, baseline });
    // Only items almost equal to the query qualify; "a" is equal, "d" is not.
    expect(result.relevanceSlots).toBe(1);
    expect(names(result.items)[0]).toBe("a");
  });

  it("returns the existing selection when no item reaches the minimum", () => {
    const result = select({ queryVector: [0, 0, 1], minCloseness: 1.1 });
    expect(result.relevanceSlots).toBe(0);
    expect(result.items).toEqual(baseline);
  });

  it("returns the existing selection when there is no prompt vector", () => {
    const result = select({ queryVector: undefined });
    expect(result.relevanceSlots).toBe(0);
    expect(result.items).toEqual(baseline);
  });

  it("does not repeat an item that is both close and in the existing order", () => {
    const result = select({ queryVector: [0, 0, 1], minCloseness: 0.5 });
    expect(new Set(names(result.items)).size).toBe(result.items.length);
  });

  it("stops at half the slots even when more items are close", () => {
    // a, d, and e are all close to the style axis; only two take slots.
    const result = select({ queryVector: [0, 0, 1], minCloseness: 0.5 });
    expect(result.relevanceSlots).toBe(2);
    expect(names(result.items)).toEqual(["a", "d", "b", "c"]);
  });

  it("does not top up a short existing selection when nothing is close", () => {
    const result = select({ baseline: baseline.slice(0, 2), minCloseness: 1.1 });
    expect(result.items).toEqual(baseline.slice(0, 2));
  });
});
