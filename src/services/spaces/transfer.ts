/**
 * The space transfer engine (design D3). Pure over a `SourceReader` and a
 * `TargetWriter`: no CONFIG import, no files, no host adapters. Steps:
 * select, skip exact duplicates, preview, write per shard, check, remove.
 */
import { tryExtractScopeFromContainerTag } from "../memory-scope.js";
import { formatTagsForEmbedding } from "../turso/vector-utils.js";
import type {
  EmbeddingInfo,
  SourceReader,
  TargetWriter,
  TransferApplyResult,
  TransferFilter,
  TransferGroup,
  TransferMode,
  TransferPreview,
  TransferRow,
  TransferScope,
  TransferWriteRow,
} from "./transfer-types.js";
import { tagTextKey } from "./transfer-types.js";

export * from "./transfer-types.js";

/** Preview examples are for the screen only and never logged (spec). */
const EXAMPLE_LIMIT = 5;
const EXAMPLE_TEXT_LIMIT = 160;
const PERSONAL_GROUP_NAME = "Personal";

type EmbedFn = (text: string) => Promise<Float32Array>;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Both bounds are inclusive; the project filter matches the container tag exactly. */
function matchesFilter(row: TransferRow, filter: TransferFilter): boolean {
  if (row.createdAt < filter.since || row.createdAt > filter.until) return false;
  if (filter.projectTag !== undefined && row.containerTag !== filter.projectTag) return false;
  return true;
}

/**
 * Apply the filter to whatever the reader returned. Rows whose container tag
 * cannot be parsed carry no scope, so they can be neither written to a scoped
 * shard nor removed: the engine leaves them alone in both spaces.
 */
function selectRows(rows: TransferRow[], filter: TransferFilter): TransferRow[] {
  return rows.filter(
    (row) =>
      matchesFilter(row, filter) && tryExtractScopeFromContainerTag(row.containerTag) !== null
  );
}

/** Exact duplicates: the same id, or the same container tag and text under another id. */
function skipDuplicates(
  rows: TransferRow[],
  targetIds: Set<string>,
  targetTagTexts: Set<string>
): { kept: TransferRow[]; duplicates: number } {
  const kept: TransferRow[] = [];
  let duplicates = 0;
  for (const row of rows) {
    if (targetIds.has(row.id) || targetTagTexts.has(tagTextKey(row.containerTag, row.text))) {
      duplicates += 1;
    } else {
      kept.push(row);
    }
  }
  return { kept, duplicates };
}

/** Vectors move only when the source provably used the target's model and dimensions. */
function canReuseVectors(source: EmbeddingInfo | undefined, target: EmbeddingInfo): boolean {
  return (
    source !== undefined &&
    source.model !== undefined &&
    source.model === target.model &&
    source.dimensions === target.dimensions
  );
}

interface ScopeGroup {
  scope: TransferScope;
  scopeHash: string;
  rows: TransferRow[];
}

function groupByScope(rows: TransferRow[]): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>();
  for (const row of rows) {
    const scopeRef = tryExtractScopeFromContainerTag(row.containerTag)!;
    const key = `${scopeRef.scope}:${scopeRef.hash}`;
    const group = groups.get(key) ?? { scope: scopeRef.scope, scopeHash: scopeRef.hash, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function splitTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function requireEmbed(embed: EmbedFn | undefined): EmbedFn {
  if (!embed) {
    throw new Error("the stored vectors cannot be reused and no embed callback was provided");
  }
  return embed;
}

/** Give one row a usable vector: reuse the stored one when allowed, embed otherwise. */
async function prepareWriteRow(
  row: TransferRow,
  reuseStoredVectors: boolean,
  embed: EmbedFn | undefined
): Promise<{ row: TransferWriteRow; embedded: boolean }> {
  let vector = reuseStoredVectors ? row.vector : undefined;
  let tagsVector = reuseStoredVectors ? row.tagsVector : undefined;
  let embedded = false;

  if (vector === undefined) {
    vector = await requireEmbed(embed)(row.text);
    embedded = true;
  }
  const tags = splitTags(row.tags);
  if (tagsVector === undefined && tags.length > 0) {
    tagsVector = await requireEmbed(embed)(formatTagsForEmbedding(tags));
    embedded = true;
  }

  return {
    row: {
      id: row.id,
      text: row.text,
      containerTag: row.containerTag,
      tags: row.tags,
      type: row.type,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadata,
      isPinned: row.isPinned,
      vector,
      tagsVector,
    },
    embedded,
  };
}

/**
 * Write one scope group in batches that fit the shard's free room, one
 * transaction per batch, and set the shard's vector count after each batch.
 * Progress lands in `result` and `copiedRows` per batch, so a later failure
 * still reports how far the transfer got; earlier batches stay because a
 * re-run skips them as duplicates.
 */
async function writeScopeGroup(
  target: TargetWriter,
  group: ScopeGroup,
  maxVectorsPerShard: number,
  reuseStoredVectors: boolean,
  embed: EmbedFn | undefined,
  result: TransferApplyResult,
  copiedRows: TransferRow[]
): Promise<void> {
  let pending = group.rows;
  while (pending.length > 0) {
    const shard = await target.getWriteShard(group.scope, group.scopeHash);
    const room = maxVectorsPerShard - shard.vectorCount;
    if (room <= 0) {
      throw new Error(`the target offered shard ${shard.key} with no room left`);
    }

    const batch = pending.slice(0, room);
    const prepared: TransferWriteRow[] = [];
    for (const row of batch) {
      const writeRow = await prepareWriteRow(row, reuseStoredVectors, embed);
      prepared.push(writeRow.row);
      result.embeddedAgain = result.embeddedAgain || writeRow.embedded;
    }

    await target.insertBatch(shard, prepared);
    await target.setShardCount(shard.key, shard.vectorCount + prepared.length);

    copiedRows.push(...batch);
    result.copied += batch.length;
    pending = pending.slice(batch.length);
  }
}

/**
 * Preview a transfer: count, project groups, at most five examples (text cut
 * to 160 characters) and the duplicate count. Reads only; never writes.
 */
export async function previewTransfer(args: {
  source: SourceReader;
  target: TargetWriter;
  filter: TransferFilter;
}): Promise<TransferPreview> {
  const rows = selectRows(await args.source.readRows(args.filter), args.filter);
  const [targetIds, targetTagTexts] = await Promise.all([
    args.target.loadExistingIds(),
    args.target.loadExistingTagTexts(),
  ]);
  const { kept, duplicates } = skipDuplicates(rows, targetIds, targetTagTexts);

  const groups = new Map<string, TransferGroup>();
  for (const row of kept) {
    const scope = tryExtractScopeFromContainerTag(row.containerTag)!.scope;
    const name = scope === "user" ? PERSONAL_GROUP_NAME : (row.projectName ?? row.containerTag);
    const group = groups.get(row.containerTag) ?? { name, tag: row.containerTag, count: 0 };
    group.count += 1;
    groups.set(row.containerTag, group);
  }

  return {
    matched: rows.length,
    toCopy: kept.length,
    duplicates,
    groups: [...groups.values()],
    examples: kept.slice(0, EXAMPLE_LIMIT).map((row) => ({
      id: row.id,
      text: row.text.slice(0, EXAMPLE_TEXT_LIMIT),
    })),
  };
}

export interface TransferApplyArgs {
  source: SourceReader;
  target: TargetWriter;
  filter: TransferFilter;
  mode: TransferMode;
  /** Shard capacity; writes are split so no shard receives more rows than it has room for. */
  maxVectorsPerShard: number;
  /** Embeds one text with the target's model. Needed only when the stored vectors cannot be reused. */
  embed?: EmbedFn;
  /** The preview's matched count, so the apply can report how the source changed. */
  previewMatched?: number;
}

/**
 * Run a transfer: select and skip duplicates at apply time, write to the
 * target, and for a move check every copied id before removing it from the
 * source. Failures are reported in the result, never thrown: the counts say
 * how far the transfer got.
 */
export async function applyTransfer(args: TransferApplyArgs): Promise<TransferApplyResult> {
  const { source, target, filter, mode } = args;
  const result: TransferApplyResult = {
    ok: false,
    mode,
    copied: 0,
    skipped: 0,
    removed: 0,
    changedFromPreview: 0,
    embeddedAgain: false,
    missingIds: [],
  };

  // Steps 1 and 2: select at apply time, then drop exact duplicates.
  let kept: TransferRow[];
  try {
    const rows = selectRows(await source.readRows(filter), filter);
    result.changedFromPreview =
      args.previewMatched === undefined ? 0 : rows.length - args.previewMatched;
    const [targetIds, targetTagTexts] = await Promise.all([
      target.loadExistingIds(),
      target.loadExistingTagTexts(),
    ]);
    const selection = skipDuplicates(rows, targetIds, targetTagTexts);
    kept = selection.kept;
    result.skipped = selection.duplicates;
  } catch (error) {
    result.error = {
      step: "select",
      message: `reading the source or the target failed: ${describeError(error)}`,
    };
    return result;
  }

  // Step 4: write per scope group, in batches that fit the shard's free room.
  const copiedRows: TransferRow[] = [];
  try {
    const [sourceEmbedding, targetEmbedding] = await Promise.all([
      source.getEmbeddingInfo(),
      target.getEmbeddingSettings(),
    ]);
    const reuseStoredVectors = canReuseVectors(sourceEmbedding, targetEmbedding);
    for (const group of groupByScope(kept)) {
      await writeScopeGroup(
        target,
        group,
        args.maxVectorsPerShard,
        reuseStoredVectors,
        args.embed,
        result,
        copiedRows
      );
    }
  } catch (error) {
    result.error = {
      step: "write",
      message: `writing to the target failed after ${result.copied} memories: ${describeError(error)}`,
    };
    return result;
  }

  if (mode === "copy") {
    result.ok = true;
    return result;
  }

  // Step 5: check that every copied id is in the target.
  const copiedIds = copiedRows.map((row) => row.id);
  try {
    const found = await target.findExistingIds(copiedIds);
    result.missingIds = copiedIds.filter((id) => !found.has(id));
  } catch (error) {
    result.error = {
      step: "check",
      message: `reading the copied memories back failed: ${describeError(error)}`,
    };
    return result;
  }
  if (result.missingIds.length > 0) {
    result.error = {
      step: "check",
      message: `${result.missingIds.length} copied memory id(s) missing from the target: ${result.missingIds.join(", ")}`,
    };
    return result;
  }

  // Step 6: remove only the checked ids, one transaction per source shard.
  try {
    const byShard = new Map<string, TransferRow[]>();
    for (const row of copiedRows) {
      const shardRows = byShard.get(row.shardKey) ?? [];
      shardRows.push(row);
      byShard.set(row.shardKey, shardRows);
    }
    const before = await source.getShardCounts([...byShard.keys()]);
    for (const [shardKey, shardRows] of byShard) {
      await source.deleteFromShard(
        shardKey,
        shardRows.map((row) => row.id)
      );
      const beforeCount = before.get(shardKey) ?? shardRows.length;
      await source.setShardCount(shardKey, Math.max(0, beforeCount - shardRows.length));
      result.removed += shardRows.length;
    }
  } catch (error) {
    result.error = {
      step: "remove",
      message: `removing from the source failed after ${result.removed} memories: ${describeError(error)}`,
    };
    return result;
  }

  result.ok = true;
  return result;
}
