import { describe, expect, it } from "bun:test";
import { applySuggestions, NO_DIRECTORY } from "../web/src/lib/directory-maps.js";
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

  it("saves nothing by itself: only Save maps turns decisions into maps", () => {
    const { decisions } = applySuggestions(rows, {});
    expect(mapsToSave([], new Set(), Object.values(decisions))).toEqual([
      { from: "/code/app-feat-x", to: "/code/app" },
      { from: "/code/app-feat-y", to: "/code/app" },
    ]);
  });
});
