import { afterEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as react from "react";
import { setLanguage } from "../src/lib/i18n/index";
import { initialImportDraft } from "../src/lib/components/memory/import-draft";
import type { ImportJob, SessionPage } from "../src/lib/components/memory/import-types";
import { MEMORY_FAILED_MESSAGE } from "../../src/importer/web-import-group";

// Read the client language snapshot during server rendering, as other web specs do.
mock.module("react", () => ({
  ...react,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
const { ImportProgressBar } = await import("../src/lib/components/memory/ImportProgressBar");
const { FinishBody } = await import("../src/lib/components/memory/ImportFinish");
const { HostSessionSelection } = await import("../src/lib/components/memory/HostSessionSelection");
afterEach(() => setLanguage("en"));

const running: ImportJob = {
  id: "j",
  dryRun: false,
  state: "running",
  activeHost: "pi",
  hosts: [{ host: "pi", state: "running", phase: "memory", processed: 400, total: 1000 }],
};

it("draws the bar for a real run with the host, phase and counts", () => {
  const html = renderToStaticMarkup(<ImportProgressBar job={running} />);
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="40"');
  expect(html).toContain("Pi");
  expect(html).toContain("Memory units");
  expect(html).toContain("400 / 1000");
});

it("draws no bar for a preview", () => {
  expect(renderToStaticMarkup(<ImportProgressBar job={{ ...running, dryRun: true }} />)).toBe("");
});

it("shows the failed reason and the failed count on its own line", () => {
  const job: ImportJob = {
    id: "j",
    dryRun: false,
    state: "failed",
    error: `Pi: ${MEMORY_FAILED_MESSAGE}`,
    hosts: [
      {
        host: "pi",
        state: "failed",
        error: `Pi: ${MEMORY_FAILED_MESSAGE}`,
        summary: { unitsFailed: 3 },
      },
    ],
  };
  const html = renderToStaticMarkup(<FinishBody job={job} />);
  expect(html).toContain("Some memory units failed.");
  expect(html).toContain("Failed memory units: 3");
  expect(html).not.toContain("successful");
  setLanguage("zh");
  expect(renderToStaticMarkup(<FinishBody job={job} />)).toContain("失败的记忆单元: 3");
});

it("shows counts for a successful run", () => {
  const job: ImportJob = {
    id: "j",
    dryRun: false,
    state: "done",
    summary: { unitsImported: 7 },
  };
  const html = renderToStaticMarkup(<FinishBody job={job} />);
  expect(html).toContain("Imported memory units: 7");
  expect(html).toContain("Failed memory units: 0");
});

function listed(page: Partial<SessionPage>) {
  const draft = initialImportDraft();
  draft.hosts.pi.page = {
    source: { displayPath: "/p", sourceToken: "t" },
    total: 1,
    offset: 0,
    rows: [],
    unresolvedCount: 0,
    revision: "r",
    listedAt: 1,
    ...page,
  } as SessionPage;
  return draft;
}
const selection = (draft: ReturnType<typeof initialImportDraft>) =>
  renderToStaticMarkup(
    <HostSessionSelection
      host="pi"
      draft={draft}
      readiness={null}
      advanced={false}
      listing={false}
      onChange={() => {}}
      onList={() => {}}
      onUnresolved={() => {}}
    />
  );

it("marks handled rows and says how many handled sessions are hidden", () => {
  const row = (key: string, handled: boolean) => ({
    key,
    sessionId: key,
    createdAt: 1,
    recordedDirectory: "/p",
    directory: "/p",
    via: "recorded" as const,
    selectable: true,
    handled,
  });
  const html = selection(
    listed({ total: 2, rows: [row("done-one", true), row("todo-two", false)], hiddenHandled: 386 })
  );
  expect(html.split("Handled</span>")).toHaveLength(2);
  expect(html).toContain("Handled sessions hidden: 386");
  expect(selection(listed({ hiddenHandled: 0 }))).not.toContain("Handled sessions hidden");
});

it("counts only the shown sessions for Select all matching", () => {
  const html = selection(listed({ total: 0, rows: [], hiddenHandled: 386 }));
  expect(html).toContain("Select all matching (0)");
  expect(html).toContain("No sessions match.");
});
