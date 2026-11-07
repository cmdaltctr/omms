import { fetchAPI } from "$lib/api";
import type { AvatarChange, AvatarLook } from "$lib/avatar-look";
import type { ActiveSpace } from "$lib/power";

/** Shapes and calls for the `/api/spaces` routes. The server owns the meaning of each code. */

export type SpaceStatus = ActiveSpace;
export type SpaceAction = "rename" | "archive" | "delete" | "switch";
/** Why the server blocks an action. The page turns each code into a sentence. */
export type DisabledReason = "default" | "active" | "archived";

export type SpaceRow = {
  id: string;
  name: string;
  createdAt: string | null;
  archived: boolean;
  /** When the space was archived. Null for a space archived before OMMS recorded the date. */
  archivedAt: string | null;
  active: boolean;
  sizeBytes: number;
  /** The avatar the space shows: default letters, a chosen icon or an uploaded image. */
  look: AvatarLook;
  disabled: Partial<Record<SpaceAction, DisabledReason>>;
};
export type BackupRow = {
  folder: string;
  path: string;
  spaceId: string;
  spaceName: string;
  createdAt: string;
  sizeBytes: number;
  fileCount: number;
};
export type SpacesSnapshot = {
  activeSpaceId: string;
  current: SpaceStatus;
  spaces: SpaceRow[];
  backups: BackupRow[];
  problem?: string;
};
/** A reply of the spaces routes: `data` on success, `error` (the server's text) and `code` on failure. */
export type SpaceResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
};
export type BackupDone = { backup: Pick<BackupRow, "folder" | "path"> };
export type DeleteDone = BackupDone & { leftoverFolder?: string };

const JSON_HEADERS = { "Content-Type": "application/json" };
// A backup copies the whole folder, so the calls that make one wait longer than the default.
const SLOW_MS = 5 * 60_000;

const call = <T>(path: string, method: string, body: unknown = {}, timeout?: number) =>
  fetchAPI<T>(path, {
    method,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    ...(timeout ? { timeout } : {}),
  }) as Promise<SpaceResult<T>>;

const one = (id: string, action: string) => `/api/spaces/${encodeURIComponent(id)}/${action}`;

export const spacesApi = {
  list: () => fetchAPI<SpacesSnapshot>("/api/spaces") as Promise<SpaceResult<SpacesSnapshot>>,
  create: (name: string) =>
    call<{ space: { id: string; name: string } }>("/api/spaces", "POST", { name }),
  switchTo: (id: string) => call<{ activeSpaceId: string }>(one(id, "switch"), "POST"),
  rename: (id: string, name: string) => call(one(id, "rename"), "POST", { name }),
  archive: (id: string) => call(one(id, "archive"), "POST"),
  unarchive: (id: string) => call(one(id, "unarchive"), "POST"),
  backUp: (id: string) => call<BackupDone>(one(id, "backup"), "POST", {}, SLOW_MS),
  remove: (id: string, confirmName: string) =>
    call<DeleteDone>(`/api/spaces/${encodeURIComponent(id)}`, "DELETE", { confirmName }, SLOW_MS),
  setLook: (id: string, change: AvatarChange) =>
    change.kind === "reset"
      ? call(one(id, "appearance"), "DELETE")
      : call(
          one(id, "appearance"),
          "PUT",
          change.kind === "icon"
            ? { kind: "icon", icon: change.icon }
            : { kind: "image", png: change.png }
        ),
  restore: (backup: string) =>
    call<{ space: { id: string; name: string } }>(
      "/api/spaces/backups/restore",
      "POST",
      { backup },
      SLOW_MS
    ),
};

/**
 * What the edit dialog saves, in order: the new name first, then the look. A refused name stops
 * the save before the look is sent. `renamed` tells the page to load the list again when the
 * look then fails, so the new name shows.
 */
export async function saveSpaceEdit(
  id: string,
  edit: { name?: string; change?: AvatarChange | null }
): Promise<SpaceResult<{ renamed: boolean }>> {
  let renamed = false;
  if (edit.name !== undefined) {
    const result = await spacesApi.rename(id, edit.name);
    if (!result.success) return { ...result, data: { renamed } };
    renamed = true;
  }
  if (edit.change) {
    const result = await spacesApi.setLook(id, edit.change);
    if (!result.success) return { ...result, data: { renamed } };
  }
  return { success: true, data: { renamed } };
}

/** The translation key that says why an action is blocked. Unknown codes get a general sentence. */
export function whyKey(action: SpaceAction, reason: string): string {
  const key = `spaces-why-${reason}-${action}`;
  return KNOWN_WHY.has(key) ? key : "spaces-why-other";
}
const KNOWN_WHY = new Set([
  "spaces-why-default-archive",
  "spaces-why-default-delete",
  "spaces-why-active-switch",
  "spaces-why-active-archive",
  "spaces-why-active-delete",
  "spaces-why-archived-switch",
]);
