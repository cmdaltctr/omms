import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractScopeFromContainerTag } from "../memory-scope.js";
import { getProjectTagInfo } from "../tags.js";
import { tursoVectorSearch } from "../turso/vector-search.js";
import { formatTagsForEmbedding } from "../turso/vector-utils.js";
import { UserProfileManager } from "../user-profile/user-profile-manager.js";
import type {
  UserProfileData,
  UserProfilePreference,
  UserProfileWorkflow,
} from "../user-profile/types.js";
import {
  SPACE_EXPORT_SCHEMA_VERSION,
  SpaceExportDocumentSchema,
  type SpaceExportDocument,
  type SpaceExportProfileItem,
} from "../../shared/api/space-export-schemas.js";
import { createStoredSpace, removeStoredSpace, type SpaceFiles } from "./registry-store.js";
import { openSpaceStore, type SpaceWriteStore } from "./space-store.js";

/** The import size cap of the spec: a file larger than this is refused. */
export const IMPORT_MAX_FILE_BYTES = 100 * 1024 * 1024;
/** How many memories are embedded per round trip to the embedder. */
const EMBED_BATCH_SIZE = 32;
/** Matches `hasEnoughWorkflowSteps` in core/extraction.ts: three filled steps. */
const MIN_WORKFLOW_STEPS = 3;

/** The embedding settings of the importing machine; `CONFIG` satisfies this. */
export interface ImportEmbeddingSettings {
  model: string;
  dimensions: number;
}

/** The importing user: user-scope memories take `userTag`. */
export interface ImportingUser {
  /** The importing user's container tag, `omms_user_<hash>`. */
  userTag: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
}

/** Embeds one text with the current model; `EmbeddingService.embed` satisfies this. */
export type ImportEmbedder = (text: string) => Promise<Float32Array>;

/** Everything the importer needs; nothing is read from CONFIG here. */
export interface ImportSpaceOptions {
  /** Path of the export file. Give this or `document`. */
  filePath?: string;
  /** A parsed export document, as the web upload check route passes it. */
  document?: unknown;
  /** The name of the new space. A taken name is refused. */
  spaceName: string;
  /** Registry and folders of the OMMS store, normally `spaceFiles(ommsHomeDir())`. */
  files: SpaceFiles;
  /** Optional project folder: every project memory takes that folder's tag. */
  retagToProject?: string;
  embedding: ImportEmbeddingSettings;
  embed: ImportEmbedder;
  user: ImportingUser;
  /** Size cap for `filePath`; defaults to {@link IMPORT_MAX_FILE_BYTES}. */
  maxFileBytes?: number;
}

/** Totals of one import, for the CLI and web dialogs to report. */
export interface ImportSpaceCounts {
  projectMemories: number;
  userMemories: number;
  /** Profile items written through the rooted profile manager. */
  profileItems: number;
  /** Distinct project tags in the file: what a `retagToProject` merges into one. */
  fileProjects: number;
}

export interface ImportSpaceResult {
  ok: boolean;
  /** Why the import was refused or failed; set only when `ok` is false. */
  reason?: string;
  /** Id of the created space; set only when `ok` is true. */
  spaceId?: string;
  spaceName?: string;
  /** The created space folder; set only when `ok` is true. */
  folder?: string;
  counts: ImportSpaceCounts;
  /** Human-facing notes, never blocking. The model warning comes first. */
  warnings: string[];
}

function emptyCounts(): ImportSpaceCounts {
  return { projectMemories: 0, userMemories: 0, profileItems: 0, fileProjects: 0 };
}

function refusedImport(reason: string, warnings: string[] = []): ImportSpaceResult {
  return { ok: false, reason, counts: emptyCounts(), warnings };
}

/**
 * The model and dimension warning of the spec: names the file's settings and
 * the current ones, and never blocks. Undefined when both match.
 */
export function embeddingWarning(
  file: ImportEmbeddingSettings,
  current: ImportEmbeddingSettings
): string | undefined {
  if (file.model === current.model && file.dimensions === current.dimensions) return undefined;
  return (
    `The file was embedded with ${file.model} at ${file.dimensions} dimensions; ` +
    `this OMMS uses ${current.model} at ${current.dimensions}. ` +
    `Import will embed every memory again with the current model.`
  );
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** How many profile items the manager will keep: a workflow needs three filled steps. */
function keptProfileItems(document: SpaceExportDocument): number {
  const profile = document.profile;
  if (!profile) return 0;
  const keptWorkflows = profile.workflows.filter(
    (item) =>
      (item.steps ?? []).filter((step) => step.trim().length > 0).length >= MIN_WORKFLOW_STEPS
  ).length;
  return profile.preferences.length + profile.patterns.length + keptWorkflows;
}

function countDocument(document: SpaceExportDocument): ImportSpaceCounts {
  const projectTags = new Set<string>();
  let projectMemories = 0;
  let userMemories = 0;
  for (const memory of document.memories) {
    if (memory.scope === "project") {
      projectMemories++;
      if (memory.projectTag) projectTags.add(memory.projectTag);
    } else {
      userMemories++;
    }
  }
  return {
    projectMemories,
    userMemories,
    profileItems: keptProfileItems(document),
    fileProjects: projectTags.size,
  };
}

export type ValidatedImport =
  | { ok: false; reason: string }
  | { ok: true; document: SpaceExportDocument; counts: ImportSpaceCounts; warning?: string };

/**
 * Validates one parsed export document against the spec rules: the schema
 * version, the schema itself, duplicate ids and the shape of every container
 * tag. Pure, so the web check route can run it without creating a space.
 */
export function validateSpaceImportDocument(
  raw: unknown,
  embedding: ImportEmbeddingSettings,
  userTag: string
): ValidatedImport {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, reason: "The file is not a space export document." };
  }
  const envelope = raw as Record<string, unknown>;
  if (
    typeof envelope.schemaVersion === "number" &&
    envelope.schemaVersion > SPACE_EXPORT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      reason:
        `The file uses schema version ${envelope.schemaVersion}, which this OMMS does not know. ` +
        `Upgrade OMMS, then import the file again.`,
    };
  }

  const parsed = SpaceExportDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `The file does not match the space export schema: ${formatIssues(parsed.error)}`,
    };
  }
  const document = parsed.data;

  const ids = new Set<string>();
  for (const memory of document.memories) {
    if (ids.has(memory.id)) {
      return { ok: false, reason: `The file holds a duplicate memory id: ${memory.id}` };
    }
    ids.add(memory.id);
  }

  // Every container tag must give a scope and hash, or the write would fail
  // after the space exists. Checked here, so a bad file creates no space.
  const tags = new Set<string>([userTag]);
  for (const memory of document.memories) {
    if (memory.scope === "project" && memory.projectTag) tags.add(memory.projectTag);
  }
  for (const tag of tags) {
    try {
      extractScopeFromContainerTag(tag);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const counts = countDocument(document);
  const warning = embeddingWarning(document.embedding, embedding);
  return { ok: true, document, counts, ...(warning ? { warning } : {}) };
}

/** Reads and parses the export file: refused when missing, oversized or not JSON. */
function readImportFile(
  filePath: string,
  maxFileBytes: number
): { ok: true; raw: unknown } | { ok: false; reason: string } {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return { ok: false, reason: `Cannot read the import file: ${filePath}` };
  }
  if (size > maxFileBytes) {
    return {
      ok: false,
      reason: `The file is ${size} bytes, larger than the import limit of ${maxFileBytes} bytes.`,
    };
  }
  try {
    return { ok: true, raw: JSON.parse(readFileSync(filePath, "utf-8")) };
  } catch (error) {
    return {
      ok: false,
      reason: `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function requireDimensions(vector: Float32Array, dimensions: number, memoryId: string): void {
  if (vector.length !== dimensions) {
    throw new Error(
      `The embedder returned ${vector.length} dimensions for memory ${memoryId}, ` +
        `but the current settings use ${dimensions}.`
    );
  }
}

/** One memory with its resolved container tag and shard scope. */
interface PreparedMemory {
  memory: SpaceExportDocument["memories"][number];
  containerTag: string;
  scope: "user" | "project";
  hash: string;
}

/** Embeds every memory with the current model, in batches, then writes per scope. */
async function writeImportedMemories(
  store: SpaceWriteStore,
  document: SpaceExportDocument,
  options: ImportSpaceOptions,
  retagTag: string | undefined
): Promise<{ projectMemories: number; userMemories: number }> {
  const groups = new Map<string, PreparedMemory[]>();
  let projectMemories = 0;
  let userMemories = 0;
  for (const memory of document.memories) {
    const containerTag =
      memory.scope === "user" ? options.user.userTag : (retagTag ?? memory.projectTag!);
    const { scope, hash } = extractScopeFromContainerTag(containerTag);
    const group = groups.get(`${scope}:${hash}`) ?? [];
    group.push({ memory, containerTag, scope, hash });
    groups.set(`${scope}:${hash}`, group);
    if (memory.scope === "project") projectMemories++;
    else userMemories++;
  }

  // The file holds no vectors, so every memory is embedded again (design D7).
  const vectors = new Map<string, { vector: Float32Array; tagsVector?: Float32Array }>();
  for (let start = 0; start < document.memories.length; start += EMBED_BATCH_SIZE) {
    const batch = document.memories.slice(start, start + EMBED_BATCH_SIZE);
    const embedded = await Promise.all(
      batch.map(async (memory) => {
        const vector = await options.embed(memory.content);
        requireDimensions(vector, options.embedding.dimensions, memory.id);
        let tagsVector: Float32Array | undefined;
        if (memory.tags && memory.tags.length > 0) {
          tagsVector = await options.embed(formatTagsForEmbedding(memory.tags));
          requireDimensions(tagsVector, options.embedding.dimensions, memory.id);
        }
        return { vector, ...(tagsVector ? { tagsVector } : {}) };
      })
    );
    batch.forEach((memory, index) => vectors.set(memory.id, embedded[index]!));
  }

  for (const group of groups.values()) {
    const { scope, hash } = group[0]!;
    await store.shards.withScopeWriteLock(scope, hash, async () => {
      const shard = await store.shards.getWriteShard(scope, hash);
      const db = await store.connections.getConnection(shard.dbPath);
      for (const item of group) {
        const embedded = vectors.get(item.memory.id)!;
        await tursoVectorSearch.insertVector(db, {
          id: item.memory.id,
          content: item.memory.content,
          vector: embedded.vector,
          ...(embedded.tagsVector ? { tagsVector: embedded.tagsVector } : {}),
          containerTag: item.containerTag,
          ...(item.memory.tags && item.memory.tags.length > 0
            ? { tags: item.memory.tags.join(",") }
            : {}),
          ...(item.memory.type ? { type: item.memory.type } : {}),
          createdAt: item.memory.createdAt,
          updatedAt: item.memory.updatedAt,
          ...(item.memory.metadata && Object.keys(item.memory.metadata).length > 0
            ? { metadata: JSON.stringify(item.memory.metadata) }
            : {}),
        });
        if (item.memory.isPinned) {
          await db.run(`UPDATE memories SET is_pinned = 1 WHERE id = ?`, [item.memory.id]);
        }
        await store.shards.incrementVectorCount(shard.id);
      }
    });
  }
  return { projectMemories, userMemories };
}

/** Maps one export item onto a preference or pattern; a missing category becomes "General". */
function toProfileItem(item: SpaceExportProfileItem): UserProfilePreference {
  return {
    category: item.category?.trim() || "General",
    description: item.description,
    confidence: item.confidence,
    frequency: item.frequency,
    evidence: item.evidence,
    lastSeen: item.lastSeen,
    ...(item.firstSeen !== undefined ? { firstSeen: item.firstSeen } : {}),
  };
}

/** Maps one export item onto a workflow; the manager drops too-short step lists. */
function toWorkflow(item: SpaceExportProfileItem): UserProfileWorkflow {
  return {
    description: item.description,
    steps: item.steps ?? [],
    confidence: item.confidence,
    frequency: item.frequency,
    evidence: item.evidence,
    lastSeen: item.lastSeen,
    ...(item.firstSeen !== undefined ? { firstSeen: item.firstSeen } : {}),
  };
}

/**
 * Writes the file's profile through a manager rooted at the new folder, with
 * the write store's connections, so one close releases every handle (design D1).
 * Items keep every field the exporter kept; the manager drops workflows with
 * too few steps, as it does on its own save path.
 */
async function writeImportedProfile(
  store: SpaceWriteStore,
  folder: string,
  document: SpaceExportDocument,
  user: ImportingUser
): Promise<number> {
  const profile = document.profile;
  if (!profile) return 0;
  const data: UserProfileData = {
    preferences: profile.preferences.map(toProfileItem),
    patterns: profile.patterns.map(toProfileItem),
    workflows: profile.workflows.map(toWorkflow),
    ...(profile.learningPaths ? { learning_paths: profile.learningPaths } : {}),
  };
  const manager = new UserProfileManager(folder, store.connections);
  const userId = user.userEmail || user.userName || user.userTag;
  await manager.createProfile(
    userId,
    user.displayName || userId,
    user.userName || userId,
    user.userEmail || userId,
    data,
    profile.totalPromptsAnalyzed
  );
  return data.preferences.length + data.patterns.length + data.workflows.length;
}

/**
 * Removes a half-created import space. The registry entry goes first: it is the
 * source of truth for which spaces exist, the new space was never active, and
 * an orphan folder is inert, while a registry entry without a folder would read
 * as a broken space. The caller has already closed the store, so no handle
 * holds the folder (Windows-safe removal).
 */
async function removeFailedSpace(
  files: SpaceFiles,
  folder: string,
  spaceId: string,
  cause: unknown
): Promise<string> {
  const message = cause instanceof Error ? cause.message : String(cause);
  try {
    await removeStoredSpace(files, spaceId);
    rmSync(folder, { recursive: true, force: true });
  } catch (cleanupError) {
    const extra = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    return (
      `Import failed: ${message}. Removing the new space failed too (${extra}). ` +
      `Delete the space "${spaceId}" by hand.`
    );
  }
  return `Import failed and the new space "${spaceId}" was removed: ${message}`;
}

/**
 * Imports one export file into a new, user-named space (design D7). Every
 * refusal runs before any space exists; a failure after the space exists
 * removes the space and its folder. The active space never changes.
 */
export async function importSpace(options: ImportSpaceOptions): Promise<ImportSpaceResult> {
  const maxFileBytes = options.maxFileBytes ?? IMPORT_MAX_FILE_BYTES;
  let raw = options.document;
  if (raw === undefined) {
    if (!options.filePath) {
      return refusedImport("No import file was given.");
    }
    const read = readImportFile(options.filePath, maxFileBytes);
    if (!read.ok) return refusedImport(read.reason);
    raw = read.raw;
  }

  const validated = validateSpaceImportDocument(raw, options.embedding, options.user.userTag);
  if (!validated.ok) return refusedImport(validated.reason);

  const warnings: string[] = [];
  if (validated.warning) warnings.push(validated.warning);

  // The retag folder must exist before any space is created (spec).
  let retagTag: string | undefined;
  if (options.retagToProject !== undefined) {
    if (!existsSync(options.retagToProject)) {
      return refusedImport(
        `The project folder "${options.retagToProject}" does not exist, so no space was created.`
      );
    }
    retagTag = getProjectTagInfo(options.retagToProject).tag;
  }

  let entry;
  try {
    entry = await createStoredSpace(options.files, options.spaceName);
  } catch (error) {
    return refusedImport(error instanceof Error ? error.message : String(error), warnings);
  }
  const folder = join(options.files.spacesRoot, entry.id);

  const store = openSpaceStore(folder, "write");
  try {
    const written = await writeImportedMemories(store, validated.document, options, retagTag);
    const profileItems = await writeImportedProfile(
      store,
      folder,
      validated.document,
      options.user
    );
    if (retagTag && validated.counts.fileProjects > 1) {
      warnings.push(
        `The ${validated.counts.fileProjects} projects in the file were merged onto one project tag.`
      );
    }
    if (written.projectMemories > 0 && !retagTag) {
      warnings.push(
        "Project tags are machine-local: a project-scope search finds these memories only " +
          "under a matching project identity. An all-projects search always finds them."
      );
    }
    return {
      ok: true,
      spaceId: entry.id,
      spaceName: entry.name,
      folder,
      counts: { ...written, profileItems, fileProjects: validated.counts.fileProjects },
      warnings,
    };
  } catch (error) {
    // Release the handles first, then remove the space (see removeFailedSpace).
    await store.close();
    const reason = await removeFailedSpace(options.files, folder, entry.id, error);
    return refusedImport(reason, warnings);
  } finally {
    await store.close();
  }
}
