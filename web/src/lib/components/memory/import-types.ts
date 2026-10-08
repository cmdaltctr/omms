import type { WebHost } from "$lib/host-label";
import type { ChosenSource } from "../settings/ImportSourcePicker";

export const IMPORT_HOSTS = ["pi", "opencode", "claude-code"] as const;
export type SessionRow = {
  key: string;
  sessionId: string | null;
  createdAt: number | null;
  recordedDirectory: string | null;
  directory: string | null;
  via: "mapped" | "recorded" | "worktree" | "unresolved";
  selectable: boolean;
};
export type SessionPage = {
  source: ChosenSource;
  total: number;
  offset: number;
  rows: SessionRow[];
  unresolvedCount: number;
  revision: string;
  listedAt: number;
};
export type Selection =
  { mode: "ids"; picked: Map<string, string> } | { mode: "all"; excluded: Set<string> };
export type HostDraft = {
  enabled: boolean;
  source: ChosenSource | null;
  page: SessionPage | null;
  listedWith: string;
  selection: Selection;
  modelChoice: string;
};
export type ImportDraft = {
  hosts: Record<WebHost, HostDraft>;
  scope: "current-project" | "all-projects";
  project: string;
  maps: string;
  since: string;
  until: string;
  profileBatch: string;
  force: boolean;
  memories: boolean;
  profile: boolean;
};
export type Readiness = {
  external: { state: string; provider: string; model: string | null };
  opencode: { available: boolean; models: { provider: string; model: string; name: string }[] };
  piReader: { available: boolean; reason?: string };
  claudeCode?: { available: boolean; defaultRoot: string; defaultRootFound: boolean };
};
export type PinnedSelection =
  | { mode: "all"; excludedKeys: string[]; revision: string; listedAt: number }
  | { mode: "ids"; sessions: { key: string; directory: string }[]; listedAt: number };
/** Additive web contract; shared options never contain per-host selections. */
export type GroupImportRequest = {
  hosts: { host: WebHost; source: string; selection: PinnedSelection; modelChoice?: string }[];
  options: {
    dryRun: boolean;
    force: boolean;
    skipMemories: boolean;
    skipProfile: boolean;
    scope: ImportDraft["scope"];
    project?: string;
    since?: number;
    until?: number;
    profileBatch?: number;
    pathMaps: { from: string; to: string }[];
  };
};
export type ImportSummary = {
  unitsTotal?: number;
  unitsWouldImport?: number;
  unitsImported?: number;
  unitsAlreadyHandled?: number;
  unitsSkipped?: number;
  unitsFailed?: number;
  unitsHeldBack?: number;
  unitsUntimed?: number;
  loadErrors?: number;
  unresolved?: number;
  profile?: {
    promptsRecorded: number;
    promptsWouldRecord: number;
    promptsAlreadyHandled?: number;
    batchesBuilt: number;
    remaining: number;
    failed: boolean;
  };
};
export type ProfileEstimate = {
  historyPrompts: number;
  waitingPrompts: number;
  totalPrompts: number;
  analysisCalls: number;
};
export type ImportCounts = {
  sessions?: number;
  processed?: number;
  total?: number;
  summary?: ImportSummary;
  profileEstimate?: ProfileEstimate;
};
export type HostResult = ImportCounts & {
  host: WebHost;
  state: string;
  phase?: string;
  profileProcessed?: number;
  profileTotal?: number;
  report?: string;
  error?: string;
  blocker?: string;
};
/** Metadata only. Conversation content must never be returned by these endpoints. */
export type ImportJob = ImportCounts & {
  id: string;
  dryRun: boolean;
  state: string;
  activeHost?: WebHost | null;
  hosts?: HostResult[];
  host?: WebHost;
  report?: string;
  error?: string;
};
