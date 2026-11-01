import { describe, expect, it } from "bun:test";
import { sortItems } from "../web/src/lib/components/paged-list/paging.ts";
import { skillText } from "../web/src/lib/i18n/skills.ts";
import type { FailureGroup } from "../web/src/lib/skills-api.ts";
import { FAILURE_SORTS } from "../web/src/lib/skills-sorts.ts";

/** A group with only the fields the sorts read. */
const group = (over: Partial<FailureGroup>): FailureGroup => ({
  name: "Read",
  errorLine: "ENOENT",
  calls: 1,
  turns: 1,
  lastSeenAt: 1_000,
  latest: [],
  ...over,
});

describe("FAILURE_SORTS", () => {
  it("starts on Most calls, descending, so the default view keeps the server order", () => {
    expect(FAILURE_SORTS[0].value).toBe("calls");
    expect(FAILURE_SORTS[0].first).toBe("desc");
  });

  it("compares calls in ascending order", () => {
    const three = group({ name: "A", calls: 3 });
    const nine = group({ name: "B", calls: 9 });
    const calls = FAILURE_SORTS.find((sort) => sort.value === "calls");
    expect(calls?.compare(three, nine)).toBeLessThan(0);
    expect(calls?.compare(nine, three)).toBeGreaterThan(0);
  });

  it("sorts by the last time seen, newest first by default", () => {
    const lastSeen = FAILURE_SORTS.find((sort) => sort.value === "lastSeen");
    expect(lastSeen?.first).toBe("desc");
    expect(lastSeen?.compare(group({ lastSeenAt: 100 }), group({ lastSeenAt: 200 }))).toBeLessThan(
      0
    );
  });

  it("sorts tools by name and breaks ties on the error line", () => {
    const tool = FAILURE_SORTS.find((sort) => sort.value === "tool");
    expect(tool?.first).toBe("asc");
    expect(tool?.compare(group({ name: "Bash" }), group({ name: "Edit" }))).toBeLessThan(0);
    expect(
      tool?.compare(
        group({ name: "Edit", errorLine: "a" }),
        group({ name: "Edit", errorLine: "b" })
      )
    ).toBeLessThan(0);
  });

  it("puts the group with the most calls first in the default descending view", () => {
    const calls = FAILURE_SORTS.find((sort) => sort.value === "calls");
    const sorted = sortItems(
      [group({ name: "small", calls: 3 }), group({ name: "big", calls: 9 })],
      calls!.compare,
      "desc"
    );
    expect(sorted.map((item) => item.calls)).toEqual([9, 3]);
  });

  it("labels every sort with a translated message", () => {
    for (const sort of FAILURE_SORTS) {
      expect(skillText).toHaveProperty(sort.label);
    }
  });
});
