import { describe, expect, it } from "bun:test";
import {
  CATEGORY_GROUP_THRESHOLD,
  collectCategoryLabels,
  groupCategoryLabels,
} from "../src/services/user-profile/category-groups.js";

/** A unit vector at the given angle in degrees; cosine between two is cos(difference). */
function at(degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

const label = (name: string, count: number, degrees: number) => ({
  label: name,
  count,
  vector: at(degrees),
});

describe("groupCategoryLabels", () => {
  it("puts two close labels into one group and lists their counts", () => {
    const groups = groupCategoryLabels([
      label("Execution", 5, 0),
      label("Direct execution", 2, 10),
      label("Release workflow", 4, 90),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.labels).toEqual([
      { label: "Execution", count: 5 },
      { label: "Direct execution", count: 2 },
    ]);
  });

  it("leaves a label with no close match out of every group", () => {
    const groups = groupCategoryLabels([
      label("Execution", 5, 0),
      label("Direct execution", 2, 10),
      label("Language", 3, 60),
    ]);
    expect(groups.flatMap((group) => group.labels.map((entry) => entry.label))).not.toContain(
      "Language"
    );
  });

  it("never groups the reserved explicit label", () => {
    const groups = groupCategoryLabels([label("explicit", 9, 0), label("Explicit notes", 1, 1)]);
    expect(groups).toEqual([]);
  });

  it("keeps A and C apart when only B links them (average linkage)", () => {
    // cos(30°) = 0.866 >= 0.80, cos(60°) = 0.5 < 0.80: A-B and B-C are close, A-C is far.
    const groups = groupCategoryLabels([label("A", 1, 0), label("B", 1, 30), label("C", 1, 60)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.labels).toHaveLength(2);
    expect(groups[0]!.labels.map((entry) => entry.label)).toContain("B");
  });

  it("gives the same group ids for the same input in any order", () => {
    const input = [label("Execution", 5, 0), label("Direct execution", 2, 10)];
    const first = groupCategoryLabels(input);
    const second = groupCategoryLabels([...input].reverse());
    expect(first[0]!.id).toBe(second[0]!.id);
    expect(first[0]!.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("uses 0.80 as the default threshold", () => {
    expect(CATEGORY_GROUP_THRESHOLD).toBe(0.8);
    // cos(35°) = 0.819 joins; cos(40°) = 0.766 does not.
    expect(groupCategoryLabels([label("A", 1, 0), label("B", 1, 35)])).toHaveLength(1);
    expect(groupCategoryLabels([label("A", 1, 0), label("B", 1, 40)])).toHaveLength(0);
  });

  it("orders groups by total item count, most first", () => {
    const groups = groupCategoryLabels([
      label("Small", 1, 0),
      label("Small two", 1, 5),
      label("Big", 9, 120),
      label("Big two", 4, 125),
    ]);
    expect(groups.map((group) => group.labels[0]!.label)).toEqual(["Big", "Small"]);
  });
});

describe("collectCategoryLabels", () => {
  it("counts labels across preferences and patterns after the spelling rules", () => {
    const item = (category: string) => ({ category, description: "d" });
    const labels = collectCategoryLabels({
      preferences: [item("Release workflow"), item("release_workflow"), item("Language")],
      patterns: [item("Release workflow")],
    });
    expect(labels).toEqual([
      { label: "Release workflow", count: 3 },
      { label: "Language", count: 1 },
    ]);
  });
});
