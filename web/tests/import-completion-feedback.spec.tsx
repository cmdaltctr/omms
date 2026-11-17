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
  expect(html).toContain("Saving memories: 400 / 1000");
  expect(html).not.toContain("Memory units");
  const profile = { ...running, hosts: [{ ...running.hosts![0]!, phase: "profile" }] };
  expect(renderToStaticMarkup(<ImportProgressBar job={profile} />)).toContain(
    "Learning your profile"
  );
});

it("draws no bar for a preview", () => {
  expect(renderToStaticMarkup(<ImportProgressBar job={{ ...running, dryRun: true }} />)).toBe("");
});

it("shows the minutes left on the bar, or says it is not known yet", () => {
  const known = renderToStaticMarkup(<ImportProgressBar job={running} minutesLeft={120} />);
  expect(known).toContain("About 120 min left");
  expect(known).not.toContain("not known yet");
  const unknown = renderToStaticMarkup(<ImportProgressBar job={running} minutesLeft={null} />);
  expect(unknown).toContain("Time left: not known yet");
  expect(renderToStaticMarkup(<ImportProgressBar job={running} />)).toContain("not known yet");
  setLanguage("zh");
  expect(renderToStaticMarkup(<ImportProgressBar job={running} minutesLeft={5} />)).toContain(
    "约剩 5 分钟"
  );
});

const failedJob: ImportJob = {
  id: "j",
  dryRun: false,
  state: "failed",
  error: `Pi: ${MEMORY_FAILED_MESSAGE}`,
  hosts: [
    {
      host: "pi",
      state: "failed",
      error: `Pi: ${MEMORY_FAILED_MESSAGE}`,
      summary: { unitsImported: 4, unitsFailed: 3 },
    },
  ],
};

it("names the host and reason, and shows the failed count on its own line", () => {
  const html = renderToStaticMarkup(<FinishBody job={failedJob} />);
  expect(html).toContain("Some memory units failed.");
  expect(html).toContain("Pi");
  expect(html).toContain("Memories saved: 4");
  expect(html).toContain("Failed: 3");
  expect(html).not.toContain("successful");
  setLanguage("zh");
  expect(renderToStaticMarkup(<FinishBody job={failedJob} />)).toContain("失败：3");
});

it("shows three plain lines for a successful run of two hosts", () => {
  const job: ImportJob = {
    id: "j",
    dryRun: false,
    state: "done",
    hosts: [
      {
        host: "pi",
        state: "done",
        summary: {
          unitsImported: 30,
          unitsFailed: 0,
          profile: {
            promptsRecorded: 70,
            promptsWouldRecord: 0,
            batchesBuilt: 2,
            remaining: 0,
            failed: false,
          },
        },
      },
      {
        host: "opencode",
        state: "done",
        summary: {
          unitsImported: 12,
          unitsFailed: 0,
          profile: {
            promptsRecorded: 50,
            promptsWouldRecord: 0,
            batchesBuilt: 1,
            remaining: 0,
            failed: false,
          },
        },
      },
    ],
  };
  const html = renderToStaticMarkup(<FinishBody job={job} />);
  expect(html).toContain("Memories saved: 42");
  expect(html).toContain("Profile updated from 120 prompts");
  expect(html).toContain("Nothing failed.");
  expect(html).not.toContain("Failed: 0");
  expect(html).not.toContain("Retry failed");
});

it("leaves the profile line out when the profile step did not run or recorded nothing", () => {
  const memoriesOnly: ImportJob = {
    id: "j",
    dryRun: false,
    state: "done",
    hosts: [{ host: "pi", state: "done", summary: { unitsImported: 5, unitsFailed: 0 } }],
  };
  const html = renderToStaticMarkup(<FinishBody job={memoriesOnly} />);
  expect(html).not.toContain("Profile updated");
  expect(html).toContain("Nothing failed.");
});

it("says the profile failed instead of 0 prompts, and prints no Failed: 0 under a failed import", () => {
  const job: ImportJob = {
    id: "j",
    dryRun: false,
    state: "failed",
    hosts: [
      {
        host: "pi",
        state: "failed",
        summary: {
          unitsImported: 2,
          unitsFailed: 0,
          profile: {
            promptsRecorded: 0,
            promptsWouldRecord: 0,
            batchesBuilt: 0,
            remaining: 4,
            failed: true,
          },
        },
      },
    ],
  };
  const html = renderToStaticMarkup(<FinishBody job={job} />);
  expect(html).toContain("Profile learning failed");
  expect(html).not.toContain("Profile updated from 0 prompts");
  expect(html).not.toContain("Failed: 0");
  expect(html).not.toContain("Nothing failed.");
});

it("says the import stopped when it failed before any unit ran and gave no reason", () => {
  const job: ImportJob = {
    id: "j",
    dryRun: false,
    state: "failed",
    hosts: [{ host: "pi", state: "failed" }],
  };
  const html = renderToStaticMarkup(<FinishBody job={job} />);
  expect(html).toContain("The import stopped before it finished.");
  expect(html).not.toContain("Failed: 0");
  expect(html).not.toContain("Nothing failed.");
});

it("offers Retry failed only when something failed and a retry is wired", () => {
  const retry = () => {};
  expect(renderToStaticMarkup(<FinishBody job={failedJob} onRetry={retry} />)).toContain(
    "Retry failed"
  );
  expect(renderToStaticMarkup(<FinishBody job={failedJob} />)).not.toContain("Retry failed");
  const ok: ImportJob = { id: "j", dryRun: false, state: "done", summary: { unitsImported: 7 } };
  expect(renderToStaticMarkup(<FinishBody job={ok} onRetry={retry} />)).not.toContain(
    "Retry failed"
  );
  const profileOnly: ImportJob = {
    id: "j",
    dryRun: false,
    state: "failed",
    hosts: [
      {
        host: "pi",
        state: "failed",
        summary: {
          unitsFailed: 0,
          profile: {
            promptsRecorded: 0,
            promptsWouldRecord: 0,
            batchesBuilt: 0,
            remaining: 4,
            failed: true,
          },
        },
      },
    ],
  };
  const html = renderToStaticMarkup(<FinishBody job={profileOnly} onRetry={retry} />);
  expect(html).toContain("Retry failed");
  expect(html).toContain("Profile learning failed");
});

it("keeps today's counters in a Details section that starts closed", () => {
  const job: ImportJob = {
    id: "j",
    dryRun: false,
    state: "done",
    summary: { unitsImported: 7, unitsFailed: 0 },
  };
  const html = renderToStaticMarkup(<FinishBody job={job} />);
  expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*>/);
  expect(html).toContain("Details");
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
      modelState=""
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

it("says 1 prompt, not 1 prompts, on the profile line", () => {
  const job: ImportJob = {
    id: "j",
    dryRun: false,
    state: "done",
    hosts: [
      {
        host: "pi",
        state: "done",
        summary: {
          unitsImported: 1,
          unitsFailed: 0,
          profile: {
            promptsRecorded: 1,
            promptsWouldRecord: 0,
            batchesBuilt: 1,
            remaining: 0,
            failed: false,
          },
        },
      },
    ],
  };
  const html = renderToStaticMarkup(<FinishBody job={job} />);
  expect(html).toContain("Profile updated from 1 prompt");
  expect(html).not.toContain("1 prompts");
});

it("hides the counts on the bar until the first count arrives", () => {
  const starting = {
    ...running,
    hosts: [{ ...running.hosts![0]!, processed: 0, total: 0 }],
  };
  const html = renderToStaticMarkup(<ImportProgressBar job={starting} />);
  expect(html).toContain("Saving memories");
  expect(html).not.toContain("0 / 0");
  expect(html).not.toContain("· 0%");
  expect(html).not.toContain("Time left");
});
