import type { WebHost } from "$lib/host-label";
import { IMPORT_HOSTS, type ImportDraft } from "./import-types";

/**
 * Where the multi-host import keeps its ticked hosts and scope in this browser. The key
 * changed when the scope default became All projects: the old key held the old default for
 * every user who had opened the page, so each user gets the new default once.
 */
export const HOST_CHOICE_KEY = "omms-memory-import-hosts-v2";
/** The key before the All projects default. Its value is ignored. */
export const OLD_HOST_CHOICE_KEY = "omms-memory-import-hosts";

type Store = Pick<Storage, "getItem" | "setItem">;

/** Remember the ticked hosts and the scope. A blocked or full store is ignored. */
export function saveHostChoice(draft: ImportDraft, storage?: Store): void {
  try {
    const store = storage ?? localStorage;
    const hosts = IMPORT_HOSTS.filter((host) => draft.hosts[host].enabled);
    store.setItem(
      HOST_CHOICE_KEY,
      JSON.stringify({ hosts, scope: draft.scope, skills: draft.skills })
    );
  } catch {
    // Private mode or blocked site data; the form still works for this visit.
  }
}

/** Tick exactly these hosts. An empty list leaves the draft as it was. */
function tickHosts(draft: ImportDraft, ticked: readonly WebHost[]): ImportDraft {
  if (ticked.length === 0) return draft;
  return {
    ...draft,
    hosts: Object.fromEntries(
      IMPORT_HOSTS.map((host) => [host, { ...draft.hosts[host], enabled: ticked.includes(host) }])
    ) as ImportDraft["hosts"],
  };
}

/**
 * Apply the remembered hosts and scope to a fresh draft. A missing, unreadable
 * or invalid choice ticks `setUp` instead, the hosts whose history exists here;
 * with none given, the draft stays as it was.
 */
export function loadHostChoice(
  draft: ImportDraft,
  storage?: Store,
  setUp: readonly WebHost[] = []
): ImportDraft {
  const fresh = tickHosts(draft, setUp);
  try {
    // Reading the global can itself throw, so it stays inside the try.
    const store = storage ?? localStorage;
    const saved: unknown = JSON.parse(store.getItem(HOST_CHOICE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return fresh;
    const { hosts, scope, skills } = saved as {
      hosts?: unknown;
      scope?: unknown;
      skills?: unknown;
    };
    const valid =
      Array.isArray(hosts) &&
      hosts.length > 0 &&
      hosts.every((host) => (IMPORT_HOSTS as readonly unknown[]).includes(host)) &&
      (scope === "current-project" || scope === "all-projects");
    if (!valid) return fresh;
    return {
      ...tickHosts(draft, hosts as WebHost[]),
      scope,
      // A choice saved before skill turns existed has no value and keeps the default (ticked).
      skills: typeof skills === "boolean" ? skills : draft.skills,
    };
  } catch {
    return fresh;
  }
}
