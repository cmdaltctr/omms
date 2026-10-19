import { expect, it } from "bun:test";
import {
  applyDraftChange,
  initialImportDraft,
  membership,
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
  const next = applyDraftChange(draft, { force: true, since: "2026-09-30" });
  expect(next.hosts.pi.page).toBe(draft.hosts.pi.page);
  expect(next.force).toBe(true);
});

it("clears the list when the project folder changes", () => {
  const next = applyDraftChange(listedDraft(), { project: "/tmp/other" });
  expect(next.hosts.pi.page).toBeNull();
});
