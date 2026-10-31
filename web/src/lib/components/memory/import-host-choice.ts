import { IMPORT_HOSTS, type ImportDraft } from "./import-types";

/** Where the multi-host import keeps its ticked hosts and scope in this browser. */
export const HOST_CHOICE_KEY = "omms-memory-import-hosts";

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

/**
 * Apply the remembered hosts and scope to a fresh draft. Anything missing,
 * unreadable or invalid leaves the draft as it was.
 */
export function loadHostChoice(draft: ImportDraft, storage?: Store): ImportDraft {
  try {
    // Reading the global can itself throw, so it stays inside the try.
    const store = storage ?? localStorage;
    const saved: unknown = JSON.parse(store.getItem(HOST_CHOICE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return draft;
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
    if (!valid) return draft;
    return {
      ...draft,
      scope,
      // A choice saved before skill turns existed has no value and keeps the default (ticked).
      skills: typeof skills === "boolean" ? skills : draft.skills,
      hosts: Object.fromEntries(
        IMPORT_HOSTS.map((host) => [
          host,
          { ...draft.hosts[host], enabled: (hosts as string[]).includes(host) },
        ])
      ) as ImportDraft["hosts"],
    };
  } catch {
    return draft;
  }
}
