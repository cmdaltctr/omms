import { describe, expect, it } from "bun:test";
import {
  NO_DIRECTORY,
  confirmedEdits,
  defaultTicks,
  groupSavedMaps,
  reviewDirectoryMaps,
  type SuggestedDirectory,
} from "../web/src/lib/directory-maps.js";
import { mapsToSave } from "../web/src/lib/external-api-settings.js";

describe("Directory map review helpers", () => {
  const rows: SuggestedDirectory[] = [
    {
      directory: "/code/app-feat-x",
      sessions: 3,
      suggestion: { kind: "map", target: "/code/app", confidence: "name" },
    },
    {
      directory: "/old/tool",
      sessions: 1,
      suggestion: { kind: "map", target: "/new/tool", confidence: "exact" },
    },
    {
      directory: "/ext/long-name",
      sessions: 2,
      suggestion: { kind: "map", target: "/ext/ln", confidence: "guess" },
    },
    { directory: "/tmp/scratch", sessions: 2, suggestion: { kind: "ignore", reason: "temporary" } },
    { directory: "/old/notes", sessions: 5, suggestion: null },
    { directory: NO_DIRECTORY, sessions: 4, suggestion: null },
  ];

  it("splits rows into maps with confidence, ignore proposals, and rows without a target", () => {
    const before = structuredClone(rows);
    const drafts = {};
    const review = reviewDirectoryMaps(rows, drafts);
    expect(review.maps).toEqual([
      { from: "/code/app-feat-x", to: "/code/app", sessions: 3, confidence: "name" },
      { from: "/old/tool", to: "/new/tool", sessions: 1, confidence: "exact" },
      { from: "/ext/long-name", to: "/ext/ln", sessions: 2, confidence: "guess" },
    ]);
    expect(review.ignores).toEqual([
      { directory: "/tmp/scratch", sessions: 2, reason: "temporary" },
    ]);
    expect(review.unmapped).toEqual(rows.slice(4));
    expect(drafts).toEqual({});
    expect(rows).toEqual(before);
  });

  it("ticks exact and name maps and every ignore proposal, never a guess", () => {
    const ticks = defaultTicks(reviewDirectoryMaps(rows, {}));
    expect([...ticks].sort()).toEqual(["/code/app-feat-x", "/old/tool", "/tmp/scratch"]);
  });

  it("counts an edited target as exact and keeps a cleared target unmapped", () => {
    const drafts = {
      "/ext/long-name": { directory: "/ext/long-name", target: " /ext/edited " },
      "/code/app-feat-x": { directory: "/code/app-feat-x", target: "" },
      "/tmp/scratch": { directory: "/tmp/scratch", target: "/manual" },
      "/unrelated": { directory: "/unrelated", target: "/other" },
    };
    const before = structuredClone(drafts);
    const review = reviewDirectoryMaps(rows, drafts);
    expect(review.maps).toEqual([
      { from: "/old/tool", to: "/new/tool", sessions: 1, confidence: "exact" },
      { from: "/ext/long-name", to: "/ext/edited", sessions: 2, confidence: "exact" },
      { from: "/tmp/scratch", to: "/manual", sessions: 2, confidence: "exact" },
    ]);
    expect(review.ignores).toEqual([]);
    expect(review.unmapped.map((row) => row.directory)).toEqual([
      "/code/app-feat-x",
      "/old/notes",
      NO_DIRECTORY,
    ]);
    expect(defaultTicks(review).has("/ext/long-name")).toBe(true);
    expect(drafts).toEqual(before);
  });

  it("combines repeated sources", () => {
    const review = reviewDirectoryMaps([rows[0], rows[0], rows[3], rows[3]], {});
    expect(review.maps).toEqual([
      { from: rows[0].directory, to: "/code/app", sessions: 6, confidence: "name" },
    ]);
    expect(review.ignores).toEqual([
      { directory: "/tmp/scratch", sessions: 4, reason: "temporary" },
    ]);
    expect(reviewDirectoryMaps([], {})).toEqual({ maps: [], ignores: [], unmapped: [] });
  });

  it("saves only ticked maps and ignores, keeping saved maps and ignored directories", () => {
    const saved = [
      { from: "/saved", to: "/keep" },
      { from: "/code/app-feat-x", to: "/old" },
    ];
    const ignored = ["/already/ignored"];
    const review = reviewDirectoryMaps(rows, {});
    const before = structuredClone({ saved, ignored });
    const edits = confirmedEdits(
      saved,
      ignored,
      review,
      new Set(["/code/app-feat-x", "/tmp/scratch"])
    );
    expect(edits).toEqual({
      importPathMaps: [
        { from: "/saved", to: "/keep" },
        { from: "/code/app-feat-x", to: "/code/app" },
      ],
      importIgnoredDirectories: ["/already/ignored", "/tmp/scratch"],
    });
    expect({ saved, ignored }).toEqual(before);
    // A key with nothing ticked is left out of the save.
    expect(confirmedEdits(saved, ignored, review, new Set(["/old/tool"]))).toEqual({
      importPathMaps: [...saved, { from: "/old/tool", to: "/new/tool" }],
    });
    expect(confirmedEdits(saved, ignored, review, new Set(["/tmp/scratch"]))).toEqual({
      importIgnoredDirectories: ["/already/ignored", "/tmp/scratch"],
    });
    expect(confirmedEdits(saved, ignored, review, new Set())).toEqual({});
  });

  it("groups saved maps by target, largest group first, then by path", () => {
    const groups = groupSavedMaps([
      { from: "/b-2", to: "/b" },
      { from: "/a-1", to: "/a" },
      { from: "/b-1", to: "/b" },
      { from: "/c-1", to: "/c" },
    ]);
    expect(groups).toEqual([
      {
        target: "/b",
        maps: [
          { from: "/b-1", to: "/b" },
          { from: "/b-2", to: "/b" },
        ],
      },
      { target: "/a", maps: [{ from: "/a-1", to: "/a" }] },
      { target: "/c", maps: [{ from: "/c-1", to: "/c" }] },
    ]);
  });

  it("saves removals only: saved maps minus the ones marked for removal", () => {
    const saved = [
      { from: "/a", to: "/x" },
      { from: "/b", to: "/y" },
    ];
    expect(mapsToSave(saved, new Set(["/a"]))).toEqual([{ from: "/b", to: "/y" }]);
    expect(mapsToSave(saved, new Set())).toEqual(saved);
  });
});
