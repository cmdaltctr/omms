import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GroupImportJob } from "../../src/importer/web-import-group.js";
import { validateWebImportRequest } from "../../src/importer/web-import-jobs.js";
import { ImportResults, workCounts } from "../src/lib/components/memory/ImportResults";
import { translateSettings } from "../src/lib/i18n/settings";
import {
  groupRequest,
  initialImportDraft,
  membership,
} from "../src/lib/components/memory/import-draft";

const job: GroupImportJob = {
  id: "synthetic-contract",
  dryRun: true,
  state: "done",
  sessions: 3,
  processed: 0,
  total: 0,
  hosts: [
    {
      host: "pi",
      state: "done",
      sessions: 3,
      phase: "memory",
      processed: 0,
      total: 0,
      profileProcessed: 0,
      profileTotal: 0,
    },
  ],
  summary: {
    dryRun: true,
    sessionsDiscovered: 3,
    sessionsLoaded: 3,
    sessionsFilteredOut: 0,
    unitsTotal: 32,
    unitsImported: 0,
    unitsWouldImport: 23,
    unitsSkipped: 0,
    unitsFailed: 0,
    unitsAlreadyHandled: 9,
    unitsHeldBack: 0,
    unitsUntimed: 0,
    projects: 1,
    unresolved: 4,
    loadErrors: 0,
    profile: {
      promptsRecorded: 0,
      promptsWouldRecord: 75,
      promptsAlreadyHandled: 12,
      batchesBuilt: 0,
      remaining: 9,
      failed: false,
    },
  },
  profileEstimate: { historyPrompts: 60, waitingPrompts: 9, totalPrompts: 69, analysisCalls: 2 },
};

it("renders authoritative server preview summaries and shared backlog estimates", () => {
  const counts = workCounts(job, (message) => message);
  for (const expected of [
    "Memory units: 32",
    "Pending memory units: 23",
    "Profile prompts: 75",
    "Estimated profile analysis calls: 2",
    "Waiting prompts inside OMMS: 9",
    "Unresolved sessions: 4",
  ])
    expect(counts).toContain(expected);
  expect(renderToStaticMarkup(<ImportResults job={job} />)).toContain("Pending memory units: 23");
});

it("renders skipped work, held-back and untimed turns, and load errors in combined and host reports", () => {
  const summary = {
    ...job.summary!,
    unitsSkipped: 7,
    unitsHeldBack: 8,
    unitsUntimed: 9,
    loadErrors: 2,
  };
  const completed = { ...job, summary, hosts: [{ ...job.hosts[0]!, summary }] };
  for (const [language, expected] of [
    ["en", ["Skipped memory units: 7", "Held-back turns: 8", "Untimed turns: 9", "Load errors: 2"]],
    ["zh", ["已跳过记忆单元: 7", "暂缓处理的轮次: 8", "无时间戳的轮次: 9", "加载错误: 2"]],
    [
      "ar",
      [
        "وحدات الذاكرة المتخطاة: 7",
        "الرسائل المؤجلة: 8",
        "الرسائل بلا طابع زمني: 9",
        "أخطاء التحميل: 2",
      ],
    ],
  ] as const) {
    const s = (message: string) => translateSettings(message, language);
    for (const counts of [completed, completed.hosts[0]!])
      for (const label of expected) expect(workCounts(counts, s)).toContain(label);
  }
  const html = renderToStaticMarkup(<ImportResults job={completed} />);
  for (const label of [
    "Skipped memory units: 7",
    "Held-back turns: 8",
    "Untimed turns: 9",
    "Load errors: 2",
  ])
    expect(html.split(label)).toHaveLength(3);
});

it("renders the server's profile progress without reporting memory completion", () => {
  const running: GroupImportJob = {
    ...job,
    dryRun: false,
    state: "running",
    activeHost: "opencode",
    hosts: [
      { ...job.hosts[0]!, host: "pi", state: "done" },
      {
        ...job.hosts[0]!,
        host: "opencode",
        state: "running",
        phase: "profile",
        profileProcessed: 2,
        profileTotal: 4,
      },
      { ...job.hosts[0]!, host: "claude-code", state: "queued", phase: "preparing" },
    ],
  };
  const html = renderToStaticMarkup(<ImportResults job={running} />);
  expect(html).toContain("Current host: OpenCode");
  expect(html).toMatch(/Profile batches.*?2.*?\/.*?4/);
  expect(html).toContain("Learning profile");
  expect(html).toContain("queued");
});

it("pins valid empty host listings as all-matching selections accepted by the backend", () => {
  const draft = initialImportDraft();
  draft.hosts.pi.page = {
    source: { sourceToken: "synthetic-token", displayPath: "/synthetic/pi" },
    rows: [],
    total: 0,
    offset: 0,
    unresolvedCount: 0,
    revision: "empty-revision",
    listedAt: 100,
  };
  draft.hosts.pi.listedWith = membership(draft, "pi");
  const request = groupRequest(draft, true);
  expect(request.hosts[0]!.selection).toEqual({
    mode: "all",
    excludedKeys: [],
    revision: "empty-revision",
    listedAt: 100,
  });
  expect(() => validateWebImportRequest(request)).not.toThrow();
});
