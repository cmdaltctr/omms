/** Shapes and calls for the `/api/skills` routes. The server owns the meaning of each code. */

export type SkillMode = "manual" | "automatic";
export type ProposalState = "pending" | "applied" | "stale" | "rejected" | "undone";

export type SkillRow = {
  name: string;
  path: string | null;
  notInWatchedFolder: boolean;
  uses: number;
  failedTurns: number;
  attention: number;
  lastUsedAt: number | null;
  mode: SkillMode;
  suggested: boolean;
  /** At least one proposal of this skill is applied now; an undone one does not count. */
  modified: boolean;
  /** When the newest applied proposal was applied, or null when the skill is not modified. */
  lastAppliedAt: number | null;
};
export type FolderRow = { path: string; skills: number; exists: boolean };
export type SkillsOverview = { recording: boolean; skills: SkillRow[]; folders: FolderRow[] };
export type TurnSummary = {
  id: number;
  createdAt: number;
  host: string;
  projectName: string | null;
  promptPreview: string;
  failedToolCalls: number;
};
export type Proposal = {
  id: string;
  kind: "improve" | "new";
  skillName: string;
  skillPath: string | null;
  content: string;
  diff: string | null;
  summary: string | null;
  evidenceTurnIds: number[];
  state: ProposalState;
  appliedBy: "person" | "agent" | "automatic" | null;
  createdAt: number;
  updatedAt: number;
  /** Lists only: false when a newer applied change superseded this one. Absent after apply. */
  canUndo?: boolean;
};
/** Uses of one UTC day. `failed` counts the turns that had a failed tool call. */
export type DailyUse = { day: string; uses: number; failed: number };
export type SkillDetailData = {
  skill: SkillRow;
  recentTurns: TurnSummary[];
  proposals: Proposal[];
  /** All recorded turns of this skill. An older server leaves it out. */
  turnTotal?: number;
  /** The last 30 UTC days, oldest first. An older server leaves it out. */
  daily?: DailyUse[];
};
export type TopSkill = { name: string; path: string | null; uses: number; failed: number };
export type ActivityBucket = "day" | "month" | "year";
/** Uses of one UTC period. `key` is `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. */
export type PeriodUse = { key: string; uses: number; failed: number };
export type SkillActivity = {
  bucket: ActivityBucket;
  /** One entry per period, oldest first, zero-filled. */
  series: PeriodUse[];
  /** The day series as before; empty for months and years. */
  days: DailyUse[];
  topSkills: TopSkill[];
  /** Distinct skills used in the window; `topSkills` may hold fewer. */
  topTotal: number;
  totals: { uses: number; failed: number; activeSkills: number };
  /** Months with a use, and years with a use plus this year, newest first. */
  available: { months: string[]; years: number[] };
};
/** `month` (`YYYY-MM`) wins over `days` for the day bucket; `year` applies to the month bucket. */
export type ActivityRequest = {
  bucket?: ActivityBucket;
  days?: number;
  month?: string;
  year?: number;
  /** How many of the most used skills to return, 1 to 100. The server default is 8. */
  top?: number;
};
export type HistoryKind = "created" | "applied" | "rejected" | "undone" | "stale";
export type HistoryEntry = {
  id: string;
  proposalId: string;
  kind: HistoryKind;
  at: number;
  summary: string;
  appliedBy: string | null;
  versionId: string | null;
  canUndo: boolean;
  laterAppliedCount: number;
  added: number;
  removed: number;
};
export type SkillHistoryPage = { total: number; entries: HistoryEntry[] };
/** One window of a server-paged list. */
export type ListWindow = { limit: number; offset: number };
export type SkillIdea = {
  name: string;
  description: string;
  reason: string;
  evidenceTurnIds: number[];
};
export type SkillStats = { turns: number; fileSize: number; recording: boolean; redact: boolean };

export type SkillsReply<T> =
  | { ok: true; code: string; data: T; message?: string }
  | { ok: false; code: string; error: string; savedContent?: string | null };

type Wire = {
  success: boolean;
  code?: string;
  data?: unknown;
  message?: string;
  error?: string;
  savedContent?: string | null;
};

/** One call. A network failure and a refusal both come back as `ok: false`, never as a throw. */
export async function skillsCall<T>(
  path: string,
  body?: Record<string, unknown>
): Promise<SkillsReply<T>> {
  try {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: {
        "x-omms-token": window.__OMMS_TOKEN__ ?? "",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const wire = (await response.json()) as Wire;
    if (wire.success) {
      return { ok: true, code: wire.code ?? "ok", data: wire.data as T, message: wire.message };
    }
    return {
      ok: false,
      code: wire.code ?? "error",
      error: wire.error ?? `Request failed (${response.status})`,
      ...(wire.savedContent !== undefined ? { savedContent: wire.savedContent } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      code: "network",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** One skill by its path, or by its name when it has no path. */
const skillQuery = (path: string | null, name: string) =>
  path ? `path=${encodeURIComponent(path)}` : `name=${encodeURIComponent(name)}`;

export const skillsApi = {
  overview: () => skillsCall<SkillsOverview>("/api/skills"),
  skill: (path: string | null, name: string, turns?: ListWindow) =>
    skillsCall<SkillDetailData>(
      `/api/skills/skill?${skillQuery(path, name)}${turns ? `&turnLimit=${turns.limit}&turnOffset=${turns.offset}` : ""}`
    ),
  activity: (request: ActivityRequest = { days: 30 }) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return skillsCall<SkillActivity>(`/api/skills/activity?${query}`);
  },
  history: (path: string | null, name: string, page: ListWindow) =>
    skillsCall<SkillHistoryPage>(
      `/api/skills/history?${skillQuery(path, name)}&limit=${page.limit}&offset=${page.offset}`
    ),
  proposals: (state?: ProposalState) =>
    skillsCall<{ proposals: Proposal[] }>(
      state ? `/api/skills/proposals?state=${state}` : "/api/skills/proposals"
    ),
  proposal: (id: string) =>
    skillsCall<{ proposal: Proposal; evidence: TurnSummary[] }>(
      `/api/skills/proposals/${encodeURIComponent(id)}`
    ),
  stats: () => skillsCall<SkillStats>("/api/skills/stats"),
  draftImprovement: (skill: string) =>
    skillsCall<{ proposal?: Proposal }>("/api/skills/draft", { skill }),
  draftNew: (idea: SkillIdea, folder: string) =>
    skillsCall<{ proposal?: Proposal }>("/api/skills/draft", { idea, folder }),
  ideas: () => skillsCall<{ ideas: SkillIdea[] }>("/api/skills/ideas", {}),
  apply: (id: string) =>
    skillsCall<{ proposal: Proposal; path: string }>("/api/skills/apply", { id }),
  reject: (id: string) => skillsCall<{ proposal: Proposal }>("/api/skills/reject", { id }),
  undo: (id: string) =>
    skillsCall<{ proposal: Proposal; path: string }>("/api/skills/undo", { id }),
  setMode: (skillPath: string, mode: SkillMode) =>
    skillsCall<{ skillPath: string; mode: SkillMode }>("/api/skills/mode", { skillPath, mode }),
  deleteTurns: () => skillsCall<{ deleted: number }>("/api/skills/delete-turns", { confirm: true }),
  recordPast: () => skillsCall<{ id: string }>("/api/skills/record-past", {}),
};
