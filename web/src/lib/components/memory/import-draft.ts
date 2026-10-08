import { localDayEnd, localDayStart } from "$lib/import-dates";
import type { WebHost } from "$lib/host-label";
import {
  IMPORT_HOSTS,
  type GroupImportRequest,
  type HostDraft,
  type ImportDraft,
  type Selection,
  type SessionRow,
} from "./import-types";

export const emptySelection = (): Selection => ({ mode: "ids", picked: new Map() });
export function initialImportDraft(): ImportDraft {
  const host = (enabled: boolean): HostDraft => ({
    enabled,
    source: null,
    page: null,
    listedWith: "",
    selection: emptySelection(),
    modelChoice: "external",
  });
  return {
    hosts: { pi: host(true), opencode: host(false), "claude-code": host(false) },
    scope: "current-project",
    project: "",
    maps: "",
    since: "",
    until: "",
    profileBatch: "",
    force: false,
    memories: true,
    profile: true,
  };
}
export function membership(draft: ImportDraft, host: WebHost): string {
  return JSON.stringify([
    draft.hosts[host].source?.sourceToken,
    draft.scope,
    draft.project,
    draft.maps,
  ]);
}
export function selectableCount(draft: ImportDraft, host: WebHost): number {
  const page = draft.hosts[host].page;
  return page ? page.total - (draft.scope === "all-projects" ? page.unresolvedCount : 0) : 0;
}
export function selectedCount(draft: ImportDraft, host: WebHost): number {
  const selection = draft.hosts[host].selection;
  return selection.mode === "all"
    ? selectableCount(draft, host) - selection.excluded.size
    : selection.picked.size;
}
export function toggleSession(selection: Selection, row: SessionRow): Selection {
  if (!row.selectable || !row.directory) return selection;
  if (selection.mode === "all") {
    const excluded = new Set(selection.excluded);
    if (excluded.has(row.key)) excluded.delete(row.key);
    else excluded.add(row.key);
    return { mode: "all", excluded };
  }
  const picked = new Map(selection.picked);
  if (picked.has(row.key)) picked.delete(row.key);
  else picked.set(row.key, row.directory);
  return { mode: "ids", picked };
}
export function parseMaps(text: string): { from: string; to: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      if (index < 1 || index === line.length - 1)
        throw new Error("Directory maps must be old=new, one per line");
      return { from: line.slice(0, index), to: line.slice(index + 1) };
    });
}
export function optionsError(draft: ImportDraft): string | null {
  if (!draft.memories && !draft.profile) return "Choose at least one output.";
  if (!IMPORT_HOSTS.some((host) => draft.hosts[host].enabled)) return "Choose at least one host.";
  try {
    parseMaps(draft.maps);
    const since = draft.since ? localDayStart(draft.since) : undefined;
    const until = draft.until ? localDayEnd(draft.until) : undefined;
    if (since !== undefined && until !== undefined && since > until)
      return "Prompt date from must not be after Prompt date to.";
  } catch (error) {
    return (error as Error).message;
  }
  if (
    draft.profileBatch &&
    (!Number.isInteger(Number(draft.profileBatch)) || Number(draft.profileBatch) < 1)
  )
    return "Profile batch size must be a positive integer.";
  return null;
}
export function groupRequest(draft: ImportDraft, dryRun: boolean): GroupImportRequest {
  const error = optionsError(draft);
  if (error) throw new Error(error);
  return {
    hosts: IMPORT_HOSTS.filter((host) => draft.hosts[host].enabled).map((host) => {
      const child = draft.hosts[host];
      if (!child.page || child.listedWith !== membership(draft, host))
        throw new Error("Options changed. Refresh the session list first.");
      const selection = child.selection;
      return {
        host,
        source: child.page.source.sourceToken,
        modelChoice: child.modelChoice || undefined,
        selection:
          selection.mode === "all" || selectableCount(draft, host) === 0
            ? {
                mode: "all",
                excludedKeys: selection.mode === "all" ? [...selection.excluded] : [],
                revision: child.page.revision,
                listedAt: child.page.listedAt,
              }
            : {
                mode: "ids",
                sessions: [...selection.picked].map(([key, directory]) => ({ key, directory })),
                listedAt: child.page.listedAt,
              },
      };
    }),
    options: {
      dryRun,
      force: draft.force,
      skipMemories: !draft.memories,
      skipProfile: !draft.profile,
      scope: draft.scope,
      ...(draft.scope === "current-project" && draft.project ? { project: draft.project } : {}),
      ...(draft.since ? { since: localDayStart(draft.since) } : {}),
      ...(draft.until ? { until: localDayEnd(draft.until) } : {}),
      ...(draft.profileBatch ? { profileBatch: Number(draft.profileBatch) } : {}),
      pathMaps: parseMaps(draft.maps),
    },
  };
}
/** Permission is tied to all selected inputs, including pinned listing metadata. */
export function previewFingerprint(draft: ImportDraft): string {
  return JSON.stringify({
    ...draft,
    hosts: IMPORT_HOSTS.filter((host) => draft.hosts[host].enabled).map((host) => {
      const child = draft.hosts[host];
      return {
        host,
        ...child,
        selection:
          child.selection.mode === "all"
            ? { mode: "all", excluded: [...child.selection.excluded].sort() }
            : { mode: "ids", picked: [...child.selection.picked].sort() },
      };
    }),
  });
}
