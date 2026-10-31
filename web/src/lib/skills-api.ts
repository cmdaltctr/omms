/** Shapes and calls for the `/api/skills` routes. The server owns the meaning of each code. */

export type SkillOrder = "uses" | "attention";
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
};
export type SkillDetailData = {
  skill: SkillRow;
  recentTurns: TurnSummary[];
  proposals: Proposal[];
};
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

export const skillsApi = {
  overview: (order: SkillOrder = "uses") =>
    skillsCall<SkillsOverview>(order === "uses" ? "/api/skills" : `/api/skills?order=${order}`),
  skill: (path: string | null, name: string) =>
    skillsCall<SkillDetailData>(
      `/api/skills/skill?${path ? `path=${encodeURIComponent(path)}` : `name=${encodeURIComponent(name)}`}`
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
