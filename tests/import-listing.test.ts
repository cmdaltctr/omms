import { expect, it } from "bun:test";
import { mergeListing } from "../web/src/lib/import-listing.js";

const first = { revision: "r1", listedAt: 1000, offset: 0 };

it("keeps the original listing time when paging within the same revision", () => {
  const next = { revision: "r1", listedAt: 5000, offset: 50 };
  expect(mergeListing(first, next, false)).toEqual({
    page: { revision: "r1", listedAt: 1000, offset: 50 },
    sameListing: true,
  });
});

it("takes the new listing time on a refresh or a changed revision", () => {
  const refreshed = { revision: "r1", listedAt: 5000, offset: 0 };
  expect(mergeListing(first, refreshed, true)).toEqual({ page: refreshed, sameListing: false });
  const changed = { revision: "r2", listedAt: 6000, offset: 50 };
  expect(mergeListing(first, changed, false)).toEqual({ page: changed, sameListing: false });
  expect(mergeListing(null, changed, false).sameListing).toBe(false);
});
