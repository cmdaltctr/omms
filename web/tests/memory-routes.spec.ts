import { expect, it } from "bun:test";
import {
  MEMORY_VIEWS,
  isAppPath,
  memoryPath,
  memoryViewFromPath,
  resolveAppPath,
  viewFromPath,
} from "../src/lib/routes";
import { legacyMemoryDestination } from "../src/lib/memory-sections";

it("lists the four Memory views in sidebar order", () => {
  expect(MEMORY_VIEWS).toEqual(["pi", "opencode", "claude-code", "shared"]);
  expect(MEMORY_VIEWS.map(memoryPath)).toEqual([
    "/memory/pi",
    "/memory/opencode",
    "/memory/claude-code",
    "/memory/shared",
  ]);
});

it("reads the Memory view from the path and treats everything else as the overview", () => {
  expect(memoryViewFromPath("/memory")).toBeNull();
  expect(memoryViewFromPath("/memory/")).toBeNull();
  expect(memoryViewFromPath("/memory/opencode")).toBe("opencode");
  expect(memoryViewFromPath("/memory/claude-code/")).toBe("claude-code");
  expect(memoryViewFromPath("/memory/shared")).toBe("shared");
  expect(memoryViewFromPath("/memory/cursor")).toBeNull();
  expect(memoryViewFromPath("/memory/pi/extra")).toBeNull();
  expect(memoryViewFromPath("/settings")).toBeNull();
});

it("keeps every Memory path on the Memory page and sends unknown sub-paths to the overview", () => {
  for (const path of ["/memory", "/memory/pi", "/memory/opencode", "/memory/shared"]) {
    expect(viewFromPath(path)).toBe("memory");
    expect(isAppPath(path)).toBe(true);
    expect(resolveAppPath(path)).toBe(path);
  }
  expect(viewFromPath("/memory/cursor")).toBe("memory");
  expect(resolveAppPath("/memory/cursor")).toBe("/memory");
  expect(resolveAppPath("/memory/pi/extra")).toBe("/memory");
  expect(viewFromPath("/memoryx")).toBe("project");
});

const cases: [string, string, string | null][] = [
  // Old Settings anchors.
  ["/settings", "#settings-section-import", "/memory"],
  ["/settings", "#settings-section-auto-import", "/memory"],
  ["/settings", "#settings-section-profile", "/memory/shared#shared-profile"],
  ["/settings", "#settings-section-memory", "/memory/shared#shared-limits"],
  ["/settings", "#settings-section-directory-maps", "/memory/shared#shared-directory-maps"],
  ["/settings", "#directory-maps-pi", "/memory/pi#host-unresolved"],
  ["/settings", "#directory-maps-opencode", "/memory/opencode#host-unresolved"],
  ["/settings", "#directory-maps-claude-code", "/memory/claude-code#host-unresolved"],
  // Old Memory section anchors.
  ["/memory", "#memory-section-import", "/memory"],
  ["/memory", "#memory-section-auto-import", "/memory"],
  ["/memory", "#memory-section-profile", "/memory/shared#shared-profile"],
  ["/memory", "#memory-section-limits", "/memory/shared#shared-limits"],
  ["/memory", "#memory-section-keywords", "/memory/shared#shared-keywords"],
  ["/memory", "#memory-section-reranker", "/memory/shared#shared-reranker"],
  ["/memory", "#memory-section-project-folders", "/memory/shared#shared-directory-maps"],
  ["/memory", "#directory-maps-opencode", "/memory/opencode#host-unresolved"],
  // Not moved or not old.
  ["/settings", "#settings-section-keys", null],
  ["/settings", "", null],
  ["/memory", "", null],
  ["/memory", "#shared-profile", null],
  ["/memory/shared", "#memory-section-reranker", null],
  ["/chat", "#settings-section-import", null],
];

for (const [path, hash, expected] of cases) {
  it(`maps ${path}${hash || " (no anchor)"} to ${expected ?? "nothing"}`, () => {
    expect(legacyMemoryDestination(path, hash)).toBe(expected);
  });
}
