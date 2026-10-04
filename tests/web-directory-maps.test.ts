import { describe, expect, it } from "bun:test";
import {
  applySuggestions,
  selectWithTargets,
  clearSelection,
  NO_DIRECTORY,
} from "../web/src/lib/directory-maps.js";
import { mapsToSave } from "../web/src/lib/external-api-settings.js";

describe("Smart resolve directories", () => {
  const rows = [
    { directory: "/code/app-feat-x", sessions: 3, suggestion: "/code/app" },
    { directory: "/code/app-feat-y", sessions: 1, suggestion: "/code/app" },
    { directory: "/tmp/scratch", sessions: 2, suggestion: null },
    { directory: NO_DIRECTORY, sessions: 4, suggestion: null },
  ];

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
