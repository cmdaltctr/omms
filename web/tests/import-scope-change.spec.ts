import { expect, it } from "bun:test";
import {
  applyDraftChange,
  groupRequest,
  initialImportDraft,
  listRequestFields,
  membership,
  selectableCount,
} from "../src/lib/components/memory/import-draft";
import type { ImportDraft, SessionPage } from "../src/lib/components/memory/import-types";

function listedDraft(): ImportDraft {
  const draft = initialImportDraft();
  const page = { total: 17, unresolvedCount: 13, rows: [] } as unknown as SessionPage;
  for (const host of ["pi", "opencode", "claude-code"] as const) {
    draft.hosts[host].page = page;
    draft.hosts[host].listedWith = membership(draft, host);
    draft.hosts[host].selection = { mode: "ids", picked: new Map([["k", {} as never]]) };
  }
  return draft;
}

it("clears every host's session list when the scope changes", () => {
  const next = applyDraftChange(listedDraft(), { scope: "all-projects" });
  for (const host of ["pi", "opencode", "claude-code"] as const) {
    expect(next.hosts[host].page).toBeNull();
    expect(next.hosts[host].listedWith).toBe("");
    expect(next.hosts[host].selection).toEqual({ mode: "ids", picked: new Map() });
  }
  expect(next.scope).toBe("all-projects");
});

it("keeps the session list when the scope is set to the same value", () => {
  const draft = listedDraft();
  const next = applyDraftChange(draft, { scope: "current-project" });
  expect(next.hosts["claude-code"].page).toBe(draft.hosts["claude-code"].page);
});

it("keeps the session list for options that do not change which sessions are listed", () => {
  const draft = listedDraft();
  const next = applyDraftChange(draft, { since: "2026-09-30", profileBatch: "20" });
  expect(next.hosts.pi.page).toBe(draft.hosts.pi.page);
  expect(next.since).toBe("2026-09-30");
});

it("clears the list when the project folder changes", () => {
  const next = applyDraftChange(listedDraft(), { project: "/tmp/other" });
  expect(next.hosts.pi.page).toBeNull();
});

it("clears every host's list and selection when the ticked outputs or handled options change", () => {
  for (const patch of [
    { memories: false },
    { profile: false },
    { force: true },
    { showHandled: true },
  ]) {
    const next = applyDraftChange(listedDraft(), patch);
    for (const host of ["pi", "opencode", "claude-code"] as const) {
      expect(next.hosts[host].page).toBeNull();
      expect(next.hosts[host].selection).toEqual({ mode: "ids", picked: new Map() });
    }
  }
});

it("counts only the sessions shown for Select all matching", () => {
  const draft = listedDraft();
  draft.hosts.pi.page = { total: 3, unresolvedCount: 0, hiddenHandled: 386, rows: [] } as never;
  expect(selectableCount(draft, "pi")).toBe(3);
});

it("lists with no handled outputs while skill turns are ticked", () => {
  const draft = initialImportDraft();
  expect(draft.skills).toBe(true);
  expect(listRequestFields(draft)).toMatchObject({ skipMemories: true, skipProfile: true });
  draft.skills = false;
  expect(listRequestFields(draft)).toMatchObject({ skipMemories: false, skipProfile: false });
});

it("marks a skill-turns-only list, which also lists sessions whose folder is gone", () => {
  const draft = initialImportDraft();
  draft.memories = false;
  draft.profile = false;
  expect(listRequestFields(draft)).toMatchObject({ skillTurnsOnly: true });
  draft.memories = true;
  expect(listRequestFields(draft)).not.toHaveProperty("skillTurnsOnly");
});

it("sends the ticked outputs and handled options with each list request", () => {
  const draft = initialImportDraft();
  draft.skills = false;
  expect(listRequestFields(draft)).toEqual({
    skipMemories: false,
    skipProfile: false,
    force: false,
    includeHandled: false,
  });
  draft.memories = false;
  draft.showHandled = true;
  expect(listRequestFields(draft)).toMatchObject({ skipMemories: true, includeHandled: true });
  draft.force = true;
  draft.showHandled = false;
  expect(listRequestFields(draft)).toMatchObject({ force: true, includeHandled: true });
});

it("sends includeHandled on an all selection when handled sessions are shown", () => {
  const draft = initialImportDraft();
  const page = {
    total: 2,
    unresolvedCount: 0,
    revision: "r",
    listedAt: 5,
    source: { sourceToken: "t" },
    rows: [],
  };
  draft.hosts.pi.page = page as never;
  draft.hosts.pi.listedWith = membership(draft, "pi");
  draft.hosts.pi.selection = { mode: "all", excluded: new Set() };
  const hidden = groupRequest(draft, false).hosts[0]!.selection;
  expect(hidden).not.toHaveProperty("includeHandled");
  draft.showHandled = true;
  draft.hosts.pi.listedWith = membership(draft, "pi");
  expect(groupRequest(draft, false).hosts[0]!.selection).toMatchObject({ includeHandled: true });
});
