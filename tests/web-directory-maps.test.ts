import { describe, expect, it } from "bun:test";
import {
  applySuggestions,
  selectWithTargets,
  clearSelection,
  NO_DIRECTORY,
  reviewDirectoryMaps,
  confirmedMapsToSave,
} from "../web/src/lib/directory-maps.js";
import { mapsToSave } from "../web/src/lib/external-api-settings.js";

describe("Directory map selection helpers", () => {
  const rows = [
    { directory: "/code/app-feat-x", sessions: 3, suggestion: "/code/app" },
    { directory: "/code/app-feat-y", sessions: 1, suggestion: "/code/app" },
    { directory: "/tmp/scratch", sessions: 2, suggestion: null },
    { directory: NO_DIRECTORY, sessions: 4, suggestion: null },
  ];

  it("reviews suggestions and session counts without selecting or mutating rows", () => {
    const before = structuredClone(rows);
    const drafts = {};
    const review = reviewDirectoryMaps(rows, drafts);
    expect(review.maps).toEqual([
      { from: "/code/app-feat-x", to: "/code/app", sessions: 3 },
      { from: "/code/app-feat-y", to: "/code/app", sessions: 1 },
    ]);
    expect(review.unmapped).toEqual(rows.slice(2));
    expect(drafts).toEqual({});
    expect(rows).toEqual(before);
  });

  it("reviews edited, cleared and already selected targets using global source keys", () => {
    const drafts = {
      "/code/app-feat-x": { directory: "/code/app-feat-x", target: "", accepted: true },
      "/code/app-feat-y": { directory: "/code/app-feat-y", target: " /edited ", accepted: false },
      "/tmp/scratch": { directory: "/tmp/scratch", target: "/manual", accepted: true },
      "/unrelated": { directory: "/unrelated", target: "/other", accepted: true },
    };
    const before = structuredClone(drafts);
    const review = reviewDirectoryMaps(rows, drafts);
    expect(review.maps).toEqual([
      { from: "/code/app-feat-y", to: "/edited", sessions: 1 },
      { from: "/tmp/scratch", to: "/manual", sessions: 2 },
    ]);
    expect(review.unmapped.map((row) => row.directory)).toEqual(["/code/app-feat-x", ""]);
    expect(drafts).toEqual(before);
    expect(reviewDirectoryMaps([rows[1]], drafts).maps[0].to).toBe("/edited");
  });

  it("keeps whitespace targets unmapped and combines repeated sources", () => {
    const review = reviewDirectoryMaps([rows[0], rows[0], rows[1]], {
      "/code/app-feat-y": { directory: "/code/app-feat-y", target: "  ", accepted: false },
    });
    expect(review.maps).toEqual([{ from: rows[0].directory, to: "/code/app", sessions: 6 }]);
    expect(review.unmapped).toEqual([rows[1]]);
    expect(reviewDirectoryMaps([], {}).maps).toEqual([]);
  });

  it("confirmation retains saved maps and excludes unrelated decisions and removals", () => {
    const saved = [
      { from: "/saved", to: "/keep" },
      { from: rows[0].directory, to: "/old" },
    ];
    const unrelated = { directory: "/other-host", target: "/other", accepted: true };
    const decisions = { [unrelated.directory]: unrelated };
    const review = reviewDirectoryMaps([rows[0]], decisions);
    const before = structuredClone(saved);
    const payload = confirmedMapsToSave(saved, review.maps);
    expect(payload).toEqual([
      { from: "/saved", to: "/keep" },
      { from: rows[0].directory, to: "/code/app" },
    ]);
    // The ordinary Save maps payload commits changes outside the reviewed host.
    expect(mapsToSave(saved, new Set(["/saved"]), [unrelated])).not.toEqual(payload);
    expect(saved).toEqual(before);
    expect(decisions).toEqual({ [unrelated.directory]: unrelated });
    expect(confirmedMapsToSave(saved, [])).toEqual(saved);
  });

  it("fills every suggestion, leaves the rest, and counts both", () => {
    const result = applySuggestions(rows, {});
    expect(result.filled).toBe(2);
    expect(result.notFilled).toBe(1);
    expect(Object.keys(result.decisions).sort()).toEqual(["/code/app-feat-x", "/code/app-feat-y"]);
    expect(result.decisions["/code/app-feat-x"]).toEqual({
      directory: "/code/app-feat-x",
      target: "/code/app",
      accepted: true,
    });
  });

  it("keeps a target the user already accepted", () => {
    const mine = { directory: "/code/app-feat-x", target: "/code/other", accepted: true };
    const result = applySuggestions(rows, { "/code/app-feat-x": mine });
    expect(result.decisions["/code/app-feat-x"]).toEqual(mine);
    expect(result.filled).toBe(1);
  });

  it("reports already selected suggestions on repeated clicks", () => {
    const first = applySuggestions(rows, {});
    const second = applySuggestions(rows, first.decisions);
    expect(second.filled).toBe(0);
    expect(second.alreadySelected).toBe(2);
    expect(second.notFilled).toBe(1);
    expect(second.decisions).toEqual(first.decisions);
  });

  it("counts accepted rows without suggestions as missing suggestions", () => {
    const result = applySuggestions(rows, {
      "/tmp/scratch": { directory: "/tmp/scratch", target: "/manual", accepted: true },
    });
    expect(result.notFilled).toBe(1);
    expect(result.alreadySelected).toBe(1);
    expect(result.decisions["/tmp/scratch"].target).toBe("/manual");
  });

  it("selects only existing targets, preserving edits including an emptied target", () => {
    const original = {
      "/code/app-feat-x": { directory: "/code/app-feat-x", target: "", accepted: false },
      "/tmp/scratch": { directory: "/tmp/scratch", target: "/manual", accepted: false },
    };
    const result = selectWithTargets(rows, original);
    expect(result["/code/app-feat-x"]).toEqual(original["/code/app-feat-x"]);
    expect(result["/code/app-feat-y"].accepted).toBe(true);
    expect(result["/tmp/scratch"]).toEqual({ ...original["/tmp/scratch"], accepted: true });
    expect(result[NO_DIRECTORY]).toBeUndefined();
    expect(original["/tmp/scratch"].accepted).toBe(false);
    expect(selectWithTargets(rows, result)).toEqual(result);
  });

  it("excludes whitespace targets and never invents a missing target", () => {
    expect(selectWithTargets(rows.slice(2), {})).toEqual({});
    const blank = { directory: "/code/app-feat-x", target: "  ", accepted: false };
    expect(selectWithTargets(rows, { [blank.directory]: blank })[blank.directory]).toEqual(blank);
  });

  it("clears a host's selections while retaining targets and shared source decisions", () => {
    const selected = selectWithTargets(rows, {});
    const other = { directory: "/other", target: "/other-main", accepted: true };
    const all = { ...selected, [other.directory]: other };
    const cleared = clearSelection([rows[0]], all);
    expect(cleared[rows[0].directory]).toEqual({ ...selected[rows[0].directory], accepted: false });
    expect(cleared[rows[1].directory].accepted).toBe(true);
    expect(cleared[other.directory]).toEqual(other);
    expect(all[rows[0].directory].accepted).toBe(true);
    const shared = selectWithTargets([rows[0]], cleared);
    expect(shared[rows[0].directory].accepted).toBe(true);
    expect(clearSelection(rows, {})).toEqual({});
  });

  it("saves nothing by itself: only Save maps turns decisions into maps", () => {
    const { decisions } = applySuggestions(rows, {});
    expect(mapsToSave([], new Set(), Object.values(decisions))).toEqual([
      { from: "/code/app-feat-x", to: "/code/app" },
      { from: "/code/app-feat-y", to: "/code/app" },
    ]);
  });
});
