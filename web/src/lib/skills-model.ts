import type { Proposal, SkillRow } from "./skills-api";

/** Fill `{name}` slots of a translated message. */
export function fill(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (slot, key: string) =>
    key in values ? String(values[key]) : slot
  );
}

/** Skills whose name holds the text, ignoring case. An empty filter keeps every skill. */
export function filterSkills(skills: SkillRow[], query: string): SkillRow[] {
  const needle = query.trim().toLowerCase();
  return needle ? skills.filter((skill) => skill.name.toLowerCase().includes(needle)) : skills;
}

export type ProposalLabel =
  "pending" | "applied" | "applied automatically" | "rejected" | "stale" | "undone";

/** The state label of a proposal. An automatic apply reads differently from one by a person. */
export function proposalLabel(proposal: Pick<Proposal, "state" | "appliedBy">): ProposalLabel {
  return proposal.state === "applied" && proposal.appliedBy === "automatic"
    ? "applied automatically"
    : proposal.state;
}

/** How many decided proposals the Skills page lists under Recent proposals. */
export const RECENT_PROPOSALS = 20;

/** The most recently changed proposals that are not pending, newest first. */
export function recentProposals<T extends Pick<Proposal, "state" | "updatedAt">>(
  proposals: readonly T[]
): T[] {
  return proposals
    .filter((p) => p.state !== "pending")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_PROPOSALS);
}

export type DiffLine = { kind: "add" | "del" | "ctx" | "hunk"; text: string };

/** Split the server's line diff into lines the page colours by their first character. */
export function diffLines(diff: string): DiffLine[] {
  return diff.split("\n").map((text) => {
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "del", text };
    return { kind: "ctx", text };
  });
}

/** Turn count with a thousands separator that does not follow the page language. */
export const countText = (n: number): string => n.toLocaleString("en-US");

/** Size in KB or MB; below 1 KB it reads in bytes. */
export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The watched folders after adding a path. A path already listed stays listed once. */
export function withFolder(folders: string[], path: string): string[] {
  const clean = path.trim();
  return clean && !folders.includes(clean) ? [...folders, clean] : folders;
}

export function withoutFolder(folders: string[], path: string): string[] {
  return folders.filter((folder) => folder !== path);
}

/** Folder paths in the settings snapshot, or null when none is saved. */
export function savedFolders(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? (value as string[])
    : null;
}

type JobLike = {
  state: string;
  processed?: number;
  total?: number;
  summary?: { skillTurnsRecorded?: number };
  hosts?: { summary?: { skillTurnsRecorded?: number } }[];
};

const ENDED_STATES = ["done", "failed", "cancelled"];
export const jobEnded = (job: Pick<JobLike, "state">): boolean => ENDED_STATES.includes(job.state);

/** Turns a Record past turns run stored: the job total, or the sum over its hosts. */
export function recordedTurns(job: JobLike): number {
  if (job.summary?.skillTurnsRecorded !== undefined) return job.summary.skillTurnsRecorded;
  return (job.hosts ?? []).reduce((sum, host) => sum + (host.summary?.skillTurnsRecorded ?? 0), 0);
}

/** Percent done for the progress bar; 0 while the total is unknown. */
export function jobPercent(job: Pick<JobLike, "processed" | "total">): number {
  const total = job.total ?? 0;
  return total > 0 ? Math.min(100, Math.floor(((job.processed ?? 0) * 100) / total)) : 0;
}
