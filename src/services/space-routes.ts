import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import * as config from "../config.js";
import type { RouteResult } from "./chat/chat-routes.js";
import { HostAppearanceError, createAppearance } from "./host-appearance.js";
import { log } from "./logger.js";
import { packageVersion } from "./package-version.js";
import { backupSpace } from "./spaces/backup.js";
import { deleteSpace } from "./spaces/delete.js";
import { folderSize } from "./spaces/folder-size.js";
import {
  DEFAULT_SPACE_ID,
  SpaceError,
  findSpace,
  listSpaces,
  isValidSpaceId,
  readRegistryFile,
  removeSpace,
  resolveSpaceFolder,
  spaceLinks,
  type SpaceEntry,
  type SpaceErrorCode,
  type SpaceRegistry,
} from "./spaces/registry.js";
import {
  archiveStoredSpace,
  createStoredSpace,
  renameStoredSpace,
  spaceFiles,
  switchStoredSpace,
  unarchiveStoredSpace,
  type SpaceFiles,
} from "./spaces/registry-store.js";
import { listBackups, restoreBackup } from "./spaces/restore.js";
import { ommsHomeDir } from "./spaces/storage-resolution.js";
import { isLoopbackAddress } from "./web-api-auth.js";

/**
 * `/api/spaces` routes (design D10). The web app is the only surface that can delete, rename, back
 * up or restore a space. Every change goes through the registry writer, then this process
 * refreshes its config so the web app itself serves the new space on the next request.
 */

type Body = Record<string, unknown>;

const ok = (data: unknown): RouteResult => ({ status: 200, body: { success: true, data } });
const fail = (status: number, code: string, error: string): RouteResult => ({
  status,
  body: { success: false, code, error },
});

export const STATUS_BY_CODE: Record<SpaceErrorCode | "transfer-busy", number> = {
  "invalid-name": 400,
  "invalid-id": 400,
  unknown: 404,
  "name-taken": 409,
  protected: 409,
  active: 409,
  archived: 409,
  "not-archived": 409,
  unreadable: 500,
  "lock-timeout": 503,
  "transfer-busy": 409,
};

/** Starts a program with arguments, without a shell. Tests inject a fake. */
export type FolderOpener = (command: string, args: string[]) => Promise<void>;

/** What a spaces request carries besides its path. */
export interface SpaceRouteOptions {
  /** Peer address of the caller. Only a loopback caller may start a file manager. */
  remoteAddress?: string;
  /** Starts the platform file manager. Defaults to the real one; tests inject a recorder. */
  startOpener?: FolderOpener;
}

/** What the status call reports: the space this process uses now. */
export function spaceStatus(directory: string) {
  config.refreshConfigIfChanged(directory);
  const { id, name, customStoragePath, problem } = config.getActiveSpace();
  return { id, name, customStoragePath, ...(problem ? { problem } : {}) };
}

/** Why an action is blocked for a space, as a code the page translates. Absent when allowed. */
function disabledReasons(space: SpaceEntry, activeId: string) {
  const isDefault = space.id === DEFAULT_SPACE_ID;
  const isActive = space.id === activeId;
  const reason = (blocked: boolean, code: string) => (blocked ? code : undefined);
  const disabled = {
    archive: isDefault ? "default" : reason(isActive, "active"),
    delete: isDefault ? "default" : reason(isActive, "active"),
    switch: space.archived ? "archived" : reason(isActive, "active"),
  };
  return Object.fromEntries(Object.entries(disabled).filter(([, code]) => code !== undefined));
}

/** The icon store of the spaces. A space id is checked first, so a path cannot leave the folder. */
function appearanceOf(files: SpaceFiles) {
  return createAppearance(files.appearanceRoot, isValidSpaceId, "Unknown space");
}

function describeSpaces(
  files: SpaceFiles,
  registry: SpaceRegistry,
  globalFolder: string,
  looks: Record<string, unknown>
) {
  return listSpaces(registry).map((space) => {
    const folder = resolveSpaceFolder(space.id, {
      globalStoragePath: globalFolder,
      spacesRoot: files.spacesRoot,
    });
    return {
      look: looks[space.id] ?? { kind: "default" },
      id: space.id,
      name: space.name,
      createdAt: space.createdAt || null,
      archived: space.archived,
      archivedAt: space.archivedAt ?? null,
      active: space.id === registry.activeSpaceId,
      folder,
      sizeBytes: folderSize(folder),
      disabled: disabledReasons(space, registry.activeSpaceId),
      links: spaceLinks(registry, space.id),
    };
  });
}

function describeBackup(path: string, summary: ReturnType<typeof listBackups>[number]) {
  return {
    folder: basename(path),
    path,
    spaceId: summary.spaceId,
    spaceName: summary.spaceName,
    createdAt: summary.createdAt,
    sizeBytes: summary.sizeBytes,
    fileCount: summary.fileCount,
  };
}

async function snapshot(files: SpaceFiles, cwd: string) {
  config.refreshConfigIfChanged(cwd);
  const { registry, problem } = readRegistryFile(files.registryPath);
  const { storagePath, skillStoragePath } = config.CONFIG;
  // Default's folder is the global one, even while a space or a project folder is in use.
  const globalFolder = skillStoragePath ?? storagePath;
  const looks = await appearanceOf(files).read(listSpaces(registry).map((space) => space.id));
  return {
    activeSpaceId: registry.activeSpaceId,
    current: spaceStatus(cwd),
    spaces: describeSpaces(files, registry, globalFolder, looks),
    backups: listBackups(files.backupsRoot).map((summary) => describeBackup(summary.path, summary)),
    ...(problem ? { problem } : {}),
  };
}

function nameOf(body: Body): string {
  return typeof body.name === "string" ? body.name : "";
}

export async function routeSpaces(
  path: string,
  method: string,
  readBody: () => Promise<Body>,
  cwd: string,
  options: SpaceRouteOptions = {}
): Promise<RouteResult | undefined> {
  if (path !== "/api/spaces" && !path.startsWith("/api/spaces/")) return undefined;
  const files = spaceFiles(ommsHomeDir());
  try {
    return await dispatch(path, method, readBody, cwd, files, options);
  } catch (error) {
    if (error instanceof SpaceError) {
      return fail(STATUS_BY_CODE[error.code] ?? 400, error.code, error.message);
    }
    if (error instanceof HostAppearanceError) return fail(error.status, "invalid", error.message);
    log(
      "spaces route: error",
      { method, name: error instanceof Error ? error.name : typeof error },
      "error"
    );
    return fail(500, "error", error instanceof Error ? error.message : "Spaces request failed");
  }
}

async function dispatch(
  path: string,
  method: string,
  readBody: () => Promise<Body>,
  cwd: string,
  files: SpaceFiles,
  options: SpaceRouteOptions
): Promise<RouteResult | undefined> {
  if (path === "/api/spaces" && method === "GET") return ok(await snapshot(files, cwd));
  if (path === "/api/spaces" && method === "POST") {
    const space = await createStoredSpace(files, nameOf(await readBody()));
    return ok({ space: { id: space.id, name: space.name } });
  }

  if (path === "/api/spaces/backups/restore" && method === "POST") {
    const wanted = (await readBody()).backup;
    const backup = listBackups(files.backupsRoot).find(
      (item) => typeof wanted === "string" && basename(item.path) === wanted
    );
    if (!backup) return fail(404, "unknown-backup", "That backup is not in the backups folder.");
    const space = await restoreBackup(files, backup.path);
    return ok({ space: { id: space.id, name: space.name } });
  }

  const icon = /^\/api\/spaces\/([^/]+)\/appearance$/.exec(path);
  if (icon && (method === "PUT" || method === "DELETE")) {
    const space = requireSpace(files, decodeURIComponent(icon[1]!));
    const appearance = appearanceOf(files);
    if (method === "DELETE") await appearance.reset(space.id);
    else {
      const body = await readBody();
      if (body.kind === "icon") await appearance.setIcon(space.id, body.icon);
      else if (body.kind === "image") await appearance.setImage(space.id, body.png);
      else return fail(400, "invalid", "kind must be icon or image");
    }
    return ok({ look: (await appearance.read([space.id]))[space.id] });
  }

  const match =
    /^\/api\/spaces\/([^/]+)(?:\/(switch|rename|archive|unarchive|backup|open-folder))?$/.exec(
      path
    );
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]!);
  const action = match[2];

  if (action && method === "POST") {
    if (action === "switch") await switchStoredSpace(files, id);
    else if (action === "archive") await archiveStoredSpace(files, id);
    else if (action === "unarchive") await unarchiveStoredSpace(files, id);
    else if (action === "rename")
      await renameStoredSpace(files, id, nameOf(await readBody()), {
        defaultFolder: globalFolder(),
      });
    else if (action === "open-folder") return await openFolder(files, id, options);
    else return ok(await backUp(files, id));
    config.refreshConfigIfChanged(cwd);
    return ok({ activeSpaceId: readRegistryFile(files.registryPath).registry.activeSpaceId });
  }

  if (!action && method === "DELETE") return remove(files, id, await readBody());
  return undefined;
}

function globalFolder(): string {
  return config.CONFIG.skillStoragePath ?? config.CONFIG.storagePath;
}

/** The file manager command of this platform. The folder is its only argument. */
const openerCommand =
  process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";

const execFileAsync = promisify(execFile);

/** The real opener. execFile runs no shell, so a path can never be reinterpreted as a command. */
async function startFileManager(command: string, args: string[]): Promise<void> {
  // The opener hands off to the file manager and exits, so this await reports a missing
  // opener without waiting on the file manager itself.
  await execFileAsync(command, args);
}

/**
 * Opens the space folder in the platform file manager. Refused unless the caller is this
 * machine, and the folder always comes from the registry, never from the request.
 */
async function openFolder(
  files: SpaceFiles,
  id: string,
  options: SpaceRouteOptions
): Promise<RouteResult> {
  if (!isLoopbackAddress(options.remoteAddress)) {
    return fail(
      403,
      "forbidden",
      "Only the local machine can open a space folder. Use the web app on this computer."
    );
  }
  const space = requireSpace(files, id);
  const folder = resolveSpaceFolder(space.id, {
    globalStoragePath: globalFolder(),
    spacesRoot: files.spacesRoot,
  });
  if (!existsSync(folder)) {
    return fail(
      409,
      "missing-folder",
      `The space folder is missing: ${folder}. Restore the space from a backup, then try again.`
    );
  }
  try {
    await (options.startOpener ?? startFileManager)(openerCommand, [folder]);
  } catch (error) {
    return fail(
      500,
      "opener",
      `Could not open the folder: ${folder}. ${
        error instanceof Error ? error.message : "The file manager did not start."
      }`
    );
  }
  return ok({ folder });
}

async function backUp(files: SpaceFiles, id: string) {
  const space = requireSpace(files, id);
  const { backupPath, manifest } = await backupSpace({
    space,
    spaceFolder: resolveSpaceFolder(space.id, {
      globalStoragePath: globalFolder(),
      spacesRoot: files.spacesRoot,
    }),
    backupsRoot: files.backupsRoot,
    ommsVersion: packageVersion(),
  });
  return {
    backup: describeBackup(backupPath, {
      path: backupPath,
      spaceId: space.id,
      spaceName: space.name,
      createdAt: manifest.createdAt,
      fileCount: manifest.fileCount,
      sizeBytes: manifest.files.reduce((total, file) => total + file.size, 0),
    }),
  };
}

function requireSpace(files: SpaceFiles, id: string): SpaceEntry {
  const space = findSpace(readRegistryFile(files.registryPath).registry, id);
  if (!space) throw new SpaceError("unknown", `No space named "${id}".`);
  return space;
}

async function remove(files: SpaceFiles, id: string, body: Body): Promise<RouteResult> {
  const space = requireSpace(files, id);
  // Refuses Default and the active space before the typed name is compared.
  removeSpace(readRegistryFile(files.registryPath).registry, space.id);
  if (body.confirmName !== space.name) {
    return fail(400, "confirm-mismatch", "Type the space name to confirm the delete.");
  }
  const result = await deleteSpace(files, space.id, { ommsVersion: packageVersion() });
  // The icon belongs to the space. A failed clean-up leaves a harmless file.
  await appearanceOf(files)
    .reset(space.id)
    .catch(() => undefined);
  const summary = listBackups(files.backupsRoot).find((item) => item.path === result.backupPath);
  return ok({
    backup: summary
      ? describeBackup(result.backupPath, summary)
      : { folder: basename(result.backupPath), path: result.backupPath },
    ...(result.leftoverFolder ? { leftoverFolder: result.leftoverFolder } : {}),
  });
}
