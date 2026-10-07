import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRetireMarker,
  retireMarkerPath,
  writeRetireMarker,
} from "../src/services/web-retire.js";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "omms-retire-"));
  homes.push(home);
  return home;
}

it("reads back the time it wrote, with no temp file left", () => {
  const home = tempHome();
  writeRetireMarker(1_700_000_000_000, { home });
  expect(readRetireMarker({ home })).toBe(1_700_000_000_000);
  expect(readdirSync(join(home, ".omms"))).toEqual(["web-retire.json"]);
  writeRetireMarker(1_800_000_000_000, { home });
  expect(readRetireMarker({ home })).toBe(1_800_000_000_000);
});

it("returns null when the marker is missing", () => {
  expect(readRetireMarker({ home: tempHome() })).toBeNull();
});

it("returns null for a damaged marker", () => {
  const home = tempHome();
  mkdirSync(join(home, ".omms"));
  for (const text of ["{not json", '{"before":"soon"}', "null", "[]"]) {
    writeFileSync(retireMarkerPath(home), text);
    expect(readRetireMarker({ home })).toBeNull();
  }
});
