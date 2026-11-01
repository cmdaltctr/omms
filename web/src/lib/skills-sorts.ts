import type { SortChoice, SortOption } from "$lib/components/paged-list";
import type { FailureGroup, ProposalState, ProposalSummary, SkillRow } from "./skills-api";

/*
 * The sorts of every list on the Skills page. Each `compare` gives the
 * ascending order; `first` is the direction a sort starts in when the
 * reader picks it. Labels are English messages that the toolbar translates.
 */

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export type SkillSort = "uses" | "attention" | "name" | "lastUsed" | "failed" | "lastModified";

export const SKILL_SORTS: readonly SortOption<SkillSort, SkillRow>[] = [
  { value: "uses", label: "Most used", first: "desc", compare: (a, b) => a.uses - b.uses },
  {
    value: "attention",
    label: "Needs attention",
    first: "desc",
    compare: (a, b) => a.attention - b.attention,
  },
  { value: "name", label: "Name (A–Z)", first: "asc", compare: byName },
  {
    value: "lastUsed",
    label: "Last used",
    first: "desc",
    compare: (a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0),
    last: (row) => row.lastUsedAt === null,
  },
  {
    value: "failed",
    label: "Failed turns",
    first: "desc",
    compare: (a, b) => a.failedTurns - b.failedTurns,
  },
  {
    value: "lastModified",
    label: "Last modified",
    first: "desc",
    compare: (a, b) => (a.lastAppliedAt ?? 0) - (b.lastAppliedAt ?? 0),
    last: (row) => row.lastAppliedAt === null,
  },
];

const byErrorLine = (a: FailureGroup, b: FailureGroup) =>
  (a.errorLine ?? "").localeCompare(b.errorLine ?? "", undefined, { sensitivity: "base" });

export type FailureSort = "calls" | "lastSeen" | "tool";
/** The failure groups of one skill, held in the browser. Most calls first matches the reply. */
export const FAILURE_SORTS: readonly SortOption<FailureSort, FailureGroup>[] = [
  {
    value: "calls",
    label: "Most calls",
    first: "desc",
    compare: (a, b) => a.calls - b.calls,
  },
  {
    value: "lastSeen",
    label: "Last seen",
    first: "desc",
    compare: (a, b) => a.lastSeenAt - b.lastSeenAt,
  },
  {
    value: "tool",
    label: "Tool (A–Z)",
    first: "asc",
    compare: (a, b) => byName(a, b) || byErrorLine(a, b),
  },
];

const STATE_ORDER: readonly ProposalState[] = ["pending", "applied", "rejected", "stale", "undone"];

export type ProposalSort = "newest" | "oldest" | "state" | "skill";
const byUpdated = (a: ProposalSummary, b: ProposalSummary) => a.updatedAt - b.updatedAt;
export const PROPOSAL_SORTS: readonly SortOption<ProposalSort, ProposalSummary>[] = [
  { value: "newest", label: "Newest", first: "desc", flip: "oldest", compare: byUpdated },
  { value: "oldest", label: "Oldest", first: "asc", flip: "newest", compare: byUpdated },
  {
    value: "state",
    label: "State",
    first: "asc",
    compare: (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
  },
  {
    value: "skill",
    label: "Skill",
    first: "asc",
    compare: (a, b) => byName({ name: a.skillName }, { name: b.skillName }),
  },
];

/** Turns and history come from the server newest first; Oldest asks for the other end. */
export type TimeSort = "newest" | "oldest";
export const TIME_SORTS: readonly SortChoice<TimeSort>[] = [
  { value: "newest", label: "Newest", first: "desc", flip: "oldest" },
  { value: "oldest", label: "Oldest", first: "asc", flip: "newest" },
];

/** Whether a time-sorted view shows the oldest row first. */
export const oldestFirst = (view: { order: "asc" | "desc" }): boolean => view.order === "asc";
