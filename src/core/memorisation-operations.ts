import { memoryClient } from "../services/client.js";
import type { LinkedSearchSettings } from "../services/linked-search.js";
import {
  findSnapshotByHostSession,
  getMemorisationById,
  listMemorisationsByTags,
  memorisationIdTaken,
} from "../services/memorisation-store.js";
import { isFullyPrivate, stripPrivateContent } from "../services/privacy.js";
import type { getTags } from "../services/tags.js";
import type { MemoryHost } from "../types/index.js";
import {
  hasAllTags,
  isMemorisationId,
  MEMORISATION_TAG,
  memorisationId,
  memorisationSizeError,
  parseTagList,
  pickRecallMatches,
  snapshotText,
  visibleTags,
  withProjectLabel,
  type MemorisationSettings,
  type MemorisationSnapshot,
} from "./memorisation.js";

export interface MemoriseArgs extends MemorisationSnapshot {
  content?: string;
  tags?: string;
}

export interface RecallArgs {
  /** A memorisation ID (`ms-4k7q2p`) or free text. */
  query?: string;
  /** Also read as an ID or text when `query` is empty. */
  memoryId?: string;
  content?: string;
  /** Comma-separated labels. Only memorisations that carry all of them match. */
  tags?: string;
  limit?: number;
}

interface MemorisationContext {
  host?: MemoryHost;
  hostSessionId?: string;
}

const SNAPSHOT_FIELDS = ["topic", "done", "doing", "next"] as const;
const BLOCKED = { success: false, error: "Private content blocked" } as const;

/** Strips `<private>` text. A field that is fully private is dropped. */
function cleanField(value: string | undefined): string | undefined {
  if (!value?.trim() || isFullyPrivate(value)) return undefined;
  return stripPrivateContent(value);
}

function callerTags(tags: string | undefined): string[] {
  return [...new Set([MEMORISATION_TAG, ...parseTagList(tags)])];
}

/** Builds the text to store, or the refusal to return. */
function memorisationText(
  args: MemoriseArgs
): { kind: "explicit" | "snapshot"; text: string } | { success: false; error: string } {
  const hasContent = Boolean(args.content?.trim());
  const hasSnapshot = SNAPSHOT_FIELDS.some((field) => args[field]?.trim());
  if (hasContent && hasSnapshot) {
    return {
      success: false,
      error: "Give content or snapshot fields (topic, done, doing, next), not both",
    };
  }
  if (!hasContent && !hasSnapshot) {
    return {
      success: false,
      error: "content or at least one snapshot field (topic, done, doing, next) required",
    };
  }
  if (hasContent) {
    if (isFullyPrivate(args.content!)) return BLOCKED;
    return { kind: "explicit", text: stripPrivateContent(args.content!) };
  }
  const text = snapshotText({
    topic: cleanField(args.topic),
    done: cleanField(args.done),
    doing: cleanField(args.doing),
    next: cleanField(args.next),
  });
  return text ? { kind: "snapshot", text } : BLOCKED;
}

/** Saves an exact memorisation: explicit text or a session snapshot. */
export async function runMemorise(
  args: MemoriseArgs,
  context: MemorisationContext,
  tags: ReturnType<typeof getTags>,
  settings: MemorisationSettings,
  linked: LinkedSearchSettings
): Promise<Record<string, unknown>> {
  const built = memorisationText(args);
  if ("success" in built) return built;
  const sizeError = memorisationSizeError(built.text, settings);
  if (sizeError) return { success: false, error: sizeError };

  const sessionId = context.hostSessionId;
  const wantsReplace = built.kind === "snapshot" && settings.memorisationRepeat === "replace";
  const earlier =
    wantsReplace && sessionId ? await findSnapshotByHostSession(sessionId, tags.project.tag) : null;

  const id =
    earlier?.id ?? (await memorisationId((candidate) => memorisationIdTaken(candidate, linked)));

  // The project name is one more label, so a label filter narrows by project. It comes after
  // the fixed tag and the caller's labels and is never doubled.
  const recordTags = withProjectLabel(callerTags(args.tags), tags.project.projectName);
  const info = tags.project;
  const result = await memoryClient.addMemory(built.text, info.tag, {
    id,
    // The client swaps the earlier row for this one in one transaction, so a failed write keeps it.
    replaceExisting: Boolean(earlier),
    type: "memorisation",
    tags: recordTags,
    memorisation: built.kind,
    host: context.host,
    hostSessionId: sessionId,
    source: "manual",
    displayName: info.displayName,
    userName: info.userName,
    userEmail: info.userEmail,
    projectPath: info.projectPath,
    projectName: info.projectName,
    gitRepoUrl: info.gitRepoUrl,
  });
  if (!result.success) return { success: false, error: result.error };

  const note =
    wantsReplace && !sessionId
      ? " It could not replace an earlier snapshot because the host gave no session ID, so it was added."
      : "";
  return {
    success: true,
    message: `Memorisation saved as ${id}.${note}`,
    id,
    replaced: Boolean(earlier),
    tags: recordTags,
  };
}

function toIso(value: unknown): string | undefined {
  return typeof value === "number" ? new Date(value).toISOString() : undefined;
}

/** How many labelled memorisations a recall with no text returns when the caller gives no limit. */
const LABEL_RECALL_LIMIT = 10;
/** A labelled text search reads this many hits, so the label filter does not drop a lower-ranked match. */
const LABEL_SEARCH_POOL = 200;

/**
 * Fetches memorisations by exact ID, or by text across memorisations only. `tags` keeps only
 * memorisations that carry every label. With `tags` and no text it returns the newest ones.
 * An exact ID ignores `tags`. Every read covers the whole active space and its linked spaces,
 * so a memorisation is found from any folder. `rerank` (the `memorisationRerank` setting)
 * lets the reranker server reorder the text matches; each match keeps its content-only
 * confidence, and the one-strong-match rule reads the first two in that order.
 */
export async function runRecall(
  args: RecallArgs,
  linked: LinkedSearchSettings,
  rerank = false
): Promise<Record<string, unknown>> {
  const input = (args.query ?? args.memoryId ?? args.content)?.trim();
  const wanted = parseTagList(args.tags);
  if (!input && wanted.length === 0) {
    return { success: false, error: "query or tags required: a memorisation ID, text or labels" };
  }

  if (!input) return recallByLabels(wanted, args.limit);

  if (isMemorisationId(input)) {
    const found = await getMemorisationById(input, null, linked);
    if (!found) return { success: false, error: `No memorisation has the ID ${input}` };
    return { success: true, count: 1, matches: [found] };
  }

  const result = await memoryClient.searchMemories(input, "", "all-projects", {
    includeLinked: true,
    kind: "memorisation",
    reranker: rerank,
    ...(wanted.length > 0 ? { limit: LABEL_SEARCH_POOL } : {}),
  });
  if (!result.success) return { success: false, error: result.error };

  const mapped = (result.results ?? [])
    .filter((hit: any) => hasAllTags(hit.tags, wanted))
    .map((hit: any) => ({
      id: hit.id as string,
      content: (hit.memory || hit.chunk) as string,
      confidence: Math.round(hit.similarity * 100),
      createdAt: toIso(hit.createdAt),
      tags: visibleTags(hit.tags),
      ...(hit.spaceName ? { space: hit.spaceName as string } : {}),
    }));
  // With the reranker on, the client already ordered the own-space rows and the sort would
  // undo that order. On a reranker failure the client falls back to the confidence order.
  const candidates = rerank ? mapped : mapped.sort((a, b) => b.confidence - a.confidence);
  const matches = pickRecallMatches(candidates, args.limit);
  return {
    success: true,
    query: input,
    count: matches.length,
    matches,
    ...(matches.length === 0 ? { message: "No memorisation matched" } : {}),
  };
}

/** The newest memorisations that carry every label. They are not ranked, so they have no confidence. */
async function recallByLabels(
  wanted: string[],
  limit: number | undefined
): Promise<Record<string, unknown>> {
  const listed = await listMemorisationsByTags(
    "",
    wanted,
    "all-projects",
    Math.max(1, limit ?? LABEL_RECALL_LIMIT)
  );
  if (!listed.success) return listed;
  const matches = listed.memories.map((memory) => ({
    id: memory.id,
    content: memory.summary,
    createdAt: memory.createdAt,
    tags: visibleTags(memory.tags),
    ...(memory.spaceName ? { space: memory.spaceName } : {}),
  }));
  return {
    success: true,
    count: matches.length,
    matches,
    ...(matches.length === 0 ? { message: "No memorisation matched" } : {}),
  };
}
