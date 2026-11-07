import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isFullyPrivate } from "../privacy.js";
import { scrubIdentifiers } from "./identifier-scrub.js";
import { openSpaceStore, type SpaceReadStore } from "./space-store.js";
import {
  SPACE_EXPORT_FORMAT,
  SPACE_EXPORT_SCHEMA_VERSION,
  SpaceExportDocumentSchema,
  type SpaceExportDocument,
  type SpaceExportLearningPath,
  type SpaceExportMemory,
  type SpaceExportProfile,
  type SpaceExportProfileItem,
} from "../../shared/api/space-export-schemas.js";

/**
 * The profile database of a space folder. Kept as a literal because importing
 * the profile manager for its constant would run the manager's constructor at
 * import time; see `USER_PROFILES_DB_NAME` in user-profile-manager.ts.
 */
const PROFILE_DB_NAME = "user-profiles.db";

/** Identity columns of a memory row: dropped whole, never exported. */
const IDENTITY_COLUMNS = [
  "display_name",
  "user_name",
  "user_email",
  "project_path",
  "project_name",
  "git_repo_url",
] as const;

/** Every column the export reads. The vector columns are absent by design. */
const MEMORY_COLUMNS =
  "id, content, container_tag, tags, type, created_at, updated_at, metadata, " +
  "display_name, user_name, user_email, project_path, project_name, git_repo_url, is_pinned";

/** What the caller passes in; nothing is read from CONFIG here (pattern of live-model-choice.ts). */
export interface ExportSpaceOptions {
  /** The space folder to read. Read-only: the space is never changed. */
  folder: string;
  /** Where the JSON file is written, atomically. The caller picks the path. */
  outPath: string;
  /** Inclusive lower bound on the memory creation time, in epoch milliseconds. */
  since?: number;
  /** Inclusive upper bound on the memory creation time, in epoch milliseconds. */
  until?: number;
  /** Opt-in that adds the user-scope memories and the learned profile. */
  includeProfile?: boolean;
  /** Recorded in the file so an import can warn on a model mismatch. */
  embeddingModel: string;
  embeddingDimensions: number;
  /** The OMMS version recorded in the file. */
  ommsVersion: string;
  /** The exporting user's home folder, checked by the final identifier scan. */
  homePath: string;
}

/** Totals of one export, for the CLI and web dialogs to report. */
export interface ExportSpaceCounts {
  /** Project-scope memories written to the file. */
  projectMemories: number;
  /** User-scope memories written to the file (opt-in only). */
  userMemories: number;
  /** Memories left out because they are fully private. */
  privateSkipped: number;
  /** Profile items written to the file (opt-in only). */
  profileItems: number;
  /** Home-folder paths the scrubber rewrote, across the whole file. */
  pathsReplaced: number;
  /** Email addresses the scrubber rewrote, across the whole file. */
  emailsReplaced: number;
}

export interface ExportSpaceResult {
  /** False when the selection held no memory: no file was written. */
  written: boolean;
  /** Why nothing was written; set only when `written` is false. */
  reason?: string;
  /** Absolute path of the written file; set only when `written` is true. */
  outputPath?: string;
  counts: ExportSpaceCounts;
  /** Human-facing notes, always including the free-text-names limit. */
  warnings: string[];
}

/** The version of this OMMS build, read from package.json; "unknown" when unreadable. */
export function getOmmsVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** The free-text limit the spec requires every export result to state. */
const FREE_TEXT_WARNING =
  "Free-text names in memory text are not detected. Check the file before you share it.";

/** Scrub one string and add its replacement counts to the totals. */
function scrub(text: string, counts: ExportSpaceCounts): string {
  const result = scrubIdentifiers(text);
  counts.pathsReplaced += result.counts.pathsReplaced;
  counts.emailsReplaced += result.counts.emailsReplaced;
  return result.text;
}

/** True when a whole metadata value is itself a folder or file path. */
function isPathValue(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value === "~" ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

/** The identity values of one row: any metadata value equal to one is dropped. */
function identityValues(row: Record<string, unknown>): Set<string> {
  const values = new Set<string>();
  for (const column of IDENTITY_COLUMNS) {
    const value = row[column];
    if (typeof value === "string" && value.trim()) values.add(value.trim());
  }
  return values;
}

/**
 * Clean one metadata value. A string that is a path or equals a row identity
 * value returns `undefined`, which drops its key; every other string is
 * scrubbed. Objects and arrays are cleaned recursively.
 */
function cleanMetadataValue(
  value: unknown,
  identities: Set<string>,
  counts: ExportSpaceCounts
): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (identities.has(trimmed) || isPathValue(trimmed)) return undefined;
    return scrub(value, counts);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    const items = value
      .map((item) => cleanMetadataValue(item, identities, counts))
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value !== null && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const result = cleanMetadataValue(child, identities, counts);
      if (result !== undefined) cleaned[key] = result;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }
  return value;
}

/** Clean the metadata JSON of one row; `undefined` when nothing survives. */
function cleanMetadata(
  raw: unknown,
  row: Record<string, unknown>,
  counts: ExportSpaceCounts
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const cleaned = cleanMetadataValue(parsed, identityValues(row), counts);
  if (cleaned === undefined || typeof cleaned !== "object") return undefined;
  return cleaned as Record<string, unknown>;
}

/** Split and scrub the comma-joined tags column; `undefined` when nothing survives. */
function cleanTags(raw: unknown, counts: ExportSpaceCounts): string[] | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const tags = raw
    .split(",")
    .map((tag) => scrub(tag.trim(), counts))
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

/** Read every memory of one scope that passes the date range. */
async function readScopeMemories(
  store: SpaceReadStore,
  scope: "project" | "user",
  options: ExportSpaceOptions,
  counts: ExportSpaceCounts
): Promise<SpaceExportMemory[]> {
  const memories: SpaceExportMemory[] = [];
  for (const shard of await store.listShards(scope, "")) {
    if (!existsSync(shard.dbPath)) continue;
    const db = await store.openShard(shard.dbPath);
    const rows = await db.all(`SELECT ${MEMORY_COLUMNS} FROM memories`);
    for (const row of rows) {
      const content = String(row.content ?? "");
      if (isFullyPrivate(content)) {
        counts.privateSkipped++;
        continue;
      }
      const createdAt = Number(row.created_at);
      if (options.since !== undefined && createdAt < options.since) continue;
      if (options.until !== undefined && createdAt > options.until) continue;

      const scrubbedContent = scrub(content, counts);
      if (!scrubbedContent.trim()) {
        counts.privateSkipped++;
        continue;
      }
      const metadata = cleanMetadata(row.metadata, row, counts);
      const tags = cleanTags(row.tags, counts);
      memories.push({
        id: String(row.id),
        content: scrubbedContent,
        scope,
        ...(scope === "project" ? { projectTag: String(row.container_tag) } : {}),
        ...(row.type ? { type: String(row.type) } : {}),
        ...(tags ? { tags } : {}),
        createdAt,
        updatedAt: Number(row.updated_at ?? createdAt),
        isPinned: Number(row.is_pinned ?? 0) === 1,
        ...(metadata ? { metadata } : {}),
      });
      if (scope === "project") counts.projectMemories++;
      else counts.userMemories++;
    }
  }
  return memories;
}

/** Map one learned item onto the export shape: no centroid, anchor or sampling fields. */
function mapProfileItem(
  item: unknown,
  counts: ExportSpaceCounts,
  withSteps: boolean
): SpaceExportProfileItem | undefined {
  if (item === null || typeof item !== "object") return undefined;
  const source = item as Record<string, unknown>;
  const description = scrub(String(source.description ?? ""), counts);
  if (!description.trim()) return undefined;
  return {
    ...(source.category !== undefined ? { category: scrub(String(source.category), counts) } : {}),
    description,
    ...(withSteps && Array.isArray(source.steps)
      ? { steps: source.steps.map((step) => scrub(String(step), counts)) }
      : {}),
    confidence: Number(source.confidence ?? 0),
    frequency: Number(source.frequency ?? 0),
    evidence: Array.isArray(source.evidence)
      ? source.evidence.map((entry) => scrub(String(entry), counts))
      : [],
    lastSeen: Number(source.lastSeen ?? 0),
    ...(source.firstSeen !== undefined ? { firstSeen: Number(source.firstSeen) } : {}),
  };
}

/** Map every learned item of one kind, dropping anything without a description. */
function mapProfileItems(
  items: unknown,
  counts: ExportSpaceCounts,
  withSteps: boolean
): SpaceExportProfileItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => mapProfileItem(item, counts, withSteps))
    .filter((item): item is SpaceExportProfileItem => item !== undefined);
}

/** Map one learning path: three scrubbed strings, nothing else. */
function mapLearningPath(
  path: unknown,
  counts: ExportSpaceCounts
): SpaceExportLearningPath | undefined {
  if (path === null || typeof path !== "object") return undefined;
  const source = path as Record<string, unknown>;
  const topic = scrub(String(source.topic ?? ""), counts);
  const description = scrub(String(source.description ?? ""), counts);
  if (!topic.trim() || !description.trim()) return undefined;
  return {
    topic,
    chain: Array.isArray(source.chain)
      ? source.chain.map((step) => scrub(String(step), counts))
      : [],
    description,
  };
}

/**
 * Read the newest active profile of the space folder, read-only. The identity
 * columns of the profile row (user id, names, email) are never read, so they
 * cannot reach the file.
 */
async function readProfile(
  store: SpaceReadStore,
  counts: ExportSpaceCounts
): Promise<SpaceExportProfile | undefined> {
  const dbPath = join(store.folder, PROFILE_DB_NAME);
  if (!existsSync(dbPath)) return undefined;
  const db = await store.openShard(dbPath);
  const table = await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_profiles'`
  );
  if (!table) return undefined;
  const row = await db.get(
    `SELECT profile_data, version, last_analyzed_at, total_prompts_analyzed
       FROM user_profiles WHERE is_active = 1 ORDER BY last_analyzed_at DESC LIMIT 1`
  );
  if (!row) return undefined;

  let data: unknown;
  try {
    data = JSON.parse(String(row.profile_data ?? "{}"));
  } catch {
    return undefined;
  }
  const source = (data ?? {}) as Record<string, unknown>;
  const preferences = mapProfileItems(source.preferences, counts, false);
  const patterns = mapProfileItems(source.patterns, counts, false);
  const workflows = mapProfileItems(source.workflows, counts, true);
  counts.profileItems = preferences.length + patterns.length + workflows.length;

  const learningPaths = (Array.isArray(source.learning_paths) ? source.learning_paths : [])
    .map((path) => mapLearningPath(path, counts))
    .filter((path): path is SpaceExportLearningPath => path !== undefined);

  return {
    preferences,
    patterns,
    workflows,
    ...(learningPaths.length > 0 ? { learningPaths } : {}),
    version: Number(row.version ?? 1),
    lastAnalyzedAt: Number(row.last_analyzed_at ?? 0),
    totalPromptsAnalyzed: Number(row.total_prompts_analyzed ?? 0),
  };
}

/** Home-folder shapes of the scrubber, re-checked on the finished file. */
const SCAN_POSIX_HOME = /(?<![\w~])\/(?:Users|home)\//;
const SCAN_WINDOWS_HOME = /(?<![\w~])[a-z]:[\\/]users[\\/]/i;
/** Wider than the scrubber's email rule: catches quoted local parts and the like. */
const SCAN_EMAIL = /\S*@\S+\.\S+/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The final safety scan (design D7): fail the export when a home-folder path
 * or an email address survived the per-string scrubbing. System paths and
 * URLs are deliberate non-matches, because memories often quote them.
 */
export function scanExportContent(serialised: string, homePath: string): void {
  const findings: string[] = [];
  const home = homePath.replace(/[\\/]+$/, "");
  if (home && new RegExp(`${escapeRegExp(home)}(?![\\w])`).test(serialised)) {
    findings.push("the home folder path of the exporting user");
  }
  if (SCAN_POSIX_HOME.test(serialised)) findings.push("a POSIX home-folder path");
  if (SCAN_WINDOWS_HOME.test(serialised)) findings.push("a Windows home-folder path");
  if (SCAN_EMAIL.test(serialised)) findings.push("an email address");
  if (findings.length > 0) {
    throw new Error(
      `Space export identifier scan failed: ${findings.join("; ")} survived the scrubber, so no file was written.`
    );
  }
}

/** Write atomically: a temporary file first, then one rename into place. */
function writeAtomic(outPath: string, serialised: string): void {
  const target = resolve(outPath);
  mkdirSync(dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, serialised, "utf-8");
    renameSync(tmpPath, target);
  } catch (error) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup; the failure below is the real error.
      }
    }
    throw error;
  }
}

/**
 * Export one space to a JSON file (design D7). Reads the space through a
 * read-only store, so the space is never changed. Throws when the final
 * identifier scan fails; returns `written: false` for an empty selection.
 */
export async function exportSpace(options: ExportSpaceOptions): Promise<ExportSpaceResult> {
  const counts: ExportSpaceCounts = {
    projectMemories: 0,
    userMemories: 0,
    privateSkipped: 0,
    profileItems: 0,
    pathsReplaced: 0,
    emailsReplaced: 0,
  };
  const warnings = [FREE_TEXT_WARNING];

  const store = openSpaceStore(options.folder, "read");
  let memories: SpaceExportMemory[];
  let profile: SpaceExportProfile | undefined;
  try {
    memories = await readScopeMemories(store, "project", options, counts);
    if (options.includeProfile) {
      memories.push(...(await readScopeMemories(store, "user", options, counts)));
      profile = await readProfile(store, counts);
      if (!profile) warnings.push("The space holds no learned profile.");
    }
  } finally {
    await store.close();
  }

  if (memories.length === 0) {
    return {
      written: false,
      reason: "Nothing to export: the selection holds no memory.",
      counts,
      warnings,
    };
  }

  memories.sort((a, b) => b.createdAt - a.createdAt);

  const document: SpaceExportDocument = {
    format: SPACE_EXPORT_FORMAT,
    schemaVersion: SPACE_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ommsVersion: options.ommsVersion,
    embedding: {
      model: options.embeddingModel,
      dimensions: options.embeddingDimensions,
    },
    memories,
    ...(profile ? { profile } : {}),
  };

  // Validate our own output before it reaches the disk, then run the final
  // identifier scan on exactly the bytes that would be written.
  SpaceExportDocumentSchema.parse(document);
  const serialised = JSON.stringify(document, null, 2);
  scanExportContent(serialised, options.homePath);

  writeAtomic(options.outPath, serialised);

  return { written: true, outputPath: resolve(options.outPath), counts, warnings };
}
