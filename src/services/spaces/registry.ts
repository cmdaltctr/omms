import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Memory space registry (ADR-041). Pure logic: it reads paths from arguments and
 * never imports CONFIG, so tests that stub `src/config.js` keep working.
 *
 * `spaces.json` holds the spaces the user created plus the active space id.
 * The Default space is not stored. It always exists and uses the global storage path.
 */

export const DEFAULT_SPACE_ID = "default";
export const DEFAULT_SPACE_NAME = "Default";
export const MAX_SPACE_ID_LENGTH = 40;
export const MAX_SPACE_NAME_LENGTH = 60;
const REGISTRY_VERSION = 1;

export interface SpaceEntry {
  id: string;
  name: string;
  /** ISO 8601 time. */
  createdAt: string;
  archived: boolean;
  /** ISO 8601 time of the archive. Absent for a space archived before OMMS recorded it. */
  archivedAt?: string;
}

export interface SpaceRegistry {
  version: number;
  activeSpaceId: string;
  /** User-created spaces only. Default is added by `listSpaces`. */
  spaces: SpaceEntry[];
}

export type SpaceErrorCode =
  | "invalid-name"
  | "name-taken"
  | "id-taken"
  | "reserved"
  | "protected"
  | "active"
  | "archived"
  | "not-archived"
  | "unknown"
  | "invalid-id"
  | "unreadable"
  | "lock-timeout";

/** A refused space operation. The message is safe to show to the user. */
export class SpaceError extends Error {
  constructor(
    readonly code: SpaceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SpaceError";
  }
}

export interface SpacePaths {
  /** The global store folder, normally `~/.omms/data`. The Default space uses it. */
  globalStoragePath: string;
  /** The folder that holds one folder per extra space, normally `~/.omms/spaces`. */
  spacesRoot: string;
}

export function emptyRegistry(): SpaceRegistry {
  return { version: REGISTRY_VERSION, activeSpaceId: DEFAULT_SPACE_ID, spaces: [] };
}

function defaultEntry(): SpaceEntry {
  return { id: DEFAULT_SPACE_ID, name: DEFAULT_SPACE_NAME, createdAt: "", archived: false };
}

/** Every space in display order: Default first, then user spaces in creation order. */
export function listSpaces(registry: SpaceRegistry): SpaceEntry[] {
  return [defaultEntry(), ...registry.spaces];
}

/** Lowercase letters, digits and single hyphens, at most 40 characters. Empty when the name has none. */
export function spaceIdFromName(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id.slice(0, MAX_SPACE_ID_LENGTH).replace(/-+$/, "");
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True for a space id that is safe to use in a path: lowercase letters, digits and single hyphens. */
export function isValidSpaceId(id: string): boolean {
  return id.length >= 1 && id.length <= MAX_SPACE_ID_LENGTH && ID_PATTERN.test(id);
}

function findByName(registry: SpaceRegistry, name: string): SpaceEntry | undefined {
  const wanted = name.trim().toLowerCase();
  return listSpaces(registry).find((space) => space.name.toLowerCase() === wanted);
}

/** Finds a space by id, or by display name without regard to case. */
export function findSpace(registry: SpaceRegistry, idOrName: string): SpaceEntry | undefined {
  const wanted = idOrName.trim().toLowerCase();
  const all = listSpaces(registry);
  return (
    all.find((space) => space.id === wanted) ?? all.find((s) => s.name.toLowerCase() === wanted)
  );
}

function requireSpace(registry: SpaceRegistry, idOrName: string): SpaceEntry {
  const space = findSpace(registry, idOrName);
  if (!space) {
    throw new SpaceError("unknown", `No space named "${idOrName}". ${validTargets(registry)}`);
  }
  return space;
}

function validTargets(registry: SpaceRegistry): string {
  const names = listSpaces(registry)
    .filter((space) => !space.archived)
    .map((space) => space.id);
  return `Spaces that can become active: ${names.join(", ")}.`;
}

function checkedName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_SPACE_NAME_LENGTH) {
    throw new SpaceError(
      "invalid-name",
      `A space name needs 1 to ${MAX_SPACE_NAME_LENGTH} characters.`
    );
  }
  return trimmed;
}

/** Adds a space. Returns the new registry and the new entry. The active space does not change. */
export function createSpace(
  registry: SpaceRegistry,
  name: string,
  now: string
): { registry: SpaceRegistry; space: SpaceEntry } {
  const display = checkedName(name);
  const existing = findByName(registry, display);
  if (existing) {
    throw new SpaceError("name-taken", `A space named "${existing.name}" already exists.`);
  }
  const id = spaceIdFromName(display);
  if (id === "") {
    throw new SpaceError("invalid-name", "A space name needs at least one letter or digit.");
  }
  if (id === DEFAULT_SPACE_ID) {
    throw new SpaceError("reserved", `The id "${DEFAULT_SPACE_ID}" belongs to the Default space.`);
  }
  const clash = registry.spaces.find((space) => space.id === id);
  if (clash) {
    throw new SpaceError(
      "id-taken",
      `The name "${display}" gives the same folder id as "${clash.name}". Choose another name.`
    );
  }
  const space: SpaceEntry = { id, name: display, createdAt: now, archived: false };
  return { registry: { ...registry, spaces: [...registry.spaces, space] }, space };
}

function updateSpace(
  registry: SpaceRegistry,
  id: string,
  change: Partial<SpaceEntry>
): SpaceRegistry {
  return {
    ...registry,
    spaces: registry.spaces.map((space) => (space.id === id ? { ...space, ...change } : space)),
  };
}

export function renameSpace(
  registry: SpaceRegistry,
  idOrName: string,
  name: string
): SpaceRegistry {
  const space = requireSpace(registry, idOrName);
  if (space.id === DEFAULT_SPACE_ID) {
    throw new SpaceError("protected", "The Default space cannot be renamed.");
  }
  const display = checkedName(name);
  const clash = findByName(registry, display);
  if (clash && clash.id !== space.id) {
    throw new SpaceError("name-taken", `A space named "${clash.name}" already exists.`);
  }
  return updateSpace(registry, space.id, { name: display });
}

export function archiveSpace(
  registry: SpaceRegistry,
  idOrName: string,
  now: string = new Date().toISOString()
): SpaceRegistry {
  const space = requireSpace(registry, idOrName);
  if (space.id === DEFAULT_SPACE_ID) {
    throw new SpaceError("protected", "The Default space cannot be archived.");
  }
  if (space.id === registry.activeSpaceId) {
    throw new SpaceError(
      "active",
      `"${space.name}" is the active space. Switch to another space first.`
    );
  }
  return updateSpace(registry, space.id, { archived: true, archivedAt: now });
}

export function unarchiveSpace(registry: SpaceRegistry, idOrName: string): SpaceRegistry {
  const space = requireSpace(registry, idOrName);
  if (!space.archived) {
    throw new SpaceError("not-archived", `"${space.name}" is not archived.`);
  }
  return updateSpace(registry, space.id, { archived: false, archivedAt: undefined });
}

export function switchSpace(registry: SpaceRegistry, idOrName: string): SpaceRegistry {
  const space = requireSpace(registry, idOrName);
  if (space.archived) {
    throw new SpaceError(
      "archived",
      `"${space.name}" is archived. Unarchive it first. ${validTargets(registry)}`
    );
  }
  return { ...registry, activeSpaceId: space.id };
}

/** Removes an entry. The caller checks backup and folder removal (D8). */
export function removeSpace(registry: SpaceRegistry, idOrName: string): SpaceRegistry {
  const space = requireSpace(registry, idOrName);
  if (space.id === DEFAULT_SPACE_ID) {
    throw new SpaceError("protected", "The Default space cannot be deleted.");
  }
  if (space.id === registry.activeSpaceId) {
    throw new SpaceError(
      "active",
      `"${space.name}" is the active space. Switch to another space first.`
    );
  }
  return { ...registry, spaces: registry.spaces.filter((s) => s.id !== space.id) };
}

/** The folder of a space. Refuses an id that is not safe, so a path cannot leave the spaces root. */
export function resolveSpaceFolder(id: string, paths: SpacePaths): string {
  if (id === DEFAULT_SPACE_ID) return paths.globalStoragePath;
  if (!isValidSpaceId(id)) {
    throw new SpaceError("invalid-id", `"${id}" is not a valid space id.`);
  }
  const root = resolve(paths.spacesRoot);
  const folder = resolve(root, id);
  if (!folder.startsWith(root + sep)) {
    throw new SpaceError("invalid-id", `"${id}" is not a valid space id.`);
  }
  return join(paths.spacesRoot, id);
}

export interface RegistryReadResult {
  registry: SpaceRegistry;
  /** Set when the file exists but cannot be used. The registry is then Default only. */
  problem?: string;
}

function parseEntry(raw: unknown): SpaceEntry | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const entry = raw as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    !isValidSpaceId(entry.id) ||
    entry.id === DEFAULT_SPACE_ID ||
    typeof entry.name !== "string" ||
    entry.name.trim() === "" ||
    typeof entry.createdAt !== "string" ||
    typeof entry.archived !== "boolean" ||
    (entry.archivedAt !== undefined && typeof entry.archivedAt !== "string")
  ) {
    return undefined;
  }
  return {
    id: entry.id,
    name: entry.name,
    createdAt: entry.createdAt,
    archived: entry.archived,
    ...(typeof entry.archivedAt === "string" ? { archivedAt: entry.archivedAt } : {}),
  };
}

/**
 * Reads `spaces.json`. A missing file means Default only. An unreadable or invalid
 * file also gives Default only, leaves the file alone, and sets `problem`.
 */
export function readRegistryFile(path: string): RegistryReadResult {
  if (!existsSync(path)) return { registry: emptyRegistry() };
  const unusable = (reason: string): RegistryReadResult => ({
    registry: emptyRegistry(),
    problem: `spaces.json is not usable (${reason}); using the Default space.`,
  });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return unusable("cannot be read as JSON");
  }
  if (typeof raw !== "object" || raw === null) return unusable("wrong shape");
  const file = raw as Record<string, unknown>;
  if (typeof file.activeSpaceId !== "string" || !Array.isArray(file.spaces)) {
    return unusable("wrong shape");
  }
  const spaces: SpaceEntry[] = [];
  for (const item of file.spaces) {
    const entry = parseEntry(item);
    if (!entry || spaces.some((space) => space.id === entry.id)) return unusable("bad entry");
    spaces.push(entry);
  }
  const registry: SpaceRegistry = {
    version: typeof file.version === "number" ? file.version : REGISTRY_VERSION,
    activeSpaceId: file.activeSpaceId,
    spaces,
  };
  if (!listSpaces(registry).some((space) => space.id === registry.activeSpaceId)) {
    return unusable(`active space "${registry.activeSpaceId}" is not in the list`);
  }
  return { registry };
}
