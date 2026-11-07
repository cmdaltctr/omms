/**
 * Types for the space transfer engine (`transfer.ts`). The engine is pure: it
 * works only through the `SourceReader` and `TargetWriter` interfaces below,
 * never imports CONFIG and never opens a file. The wiring layer implements both
 * interfaces against the space stores.
 */

export type TransferScope = "user" | "project";
export type TransferMode = "copy" | "move";

/**
 * The embedding settings of a space or shard. A missing model means legacy
 * shards that record none, which the engine treats as not provably compatible.
 */
export interface EmbeddingInfo {
  model?: string;
  dimensions: number;
}

/** One source row, shaped after the `memories` table of a shard. */
export interface TransferRow {
  id: string;
  /** Memory text (the `content` column). */
  text: string;
  /** Scope tag: `omms_project_<hash>` or `omms_user_<hash>`. */
  containerTag: string;
  /** Comma-separated tags, exactly as stored. */
  tags?: string;
  type?: string;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  /** Last update time, epoch milliseconds. */
  updatedAt: number;
  /** Stored metadata as the raw JSON string, exactly as stored. */
  metadata?: string;
  isPinned: boolean;
  /** The `project_name` column; drives the preview's project groups. */
  projectName?: string;
  /** The stored content vector, when the source shard can supply it. */
  vector?: Float32Array;
  /** The stored tags vector, when the row has one. */
  tagsVector?: Float32Array;
  /** The source shard the row was read from; drives a move's per-shard deletes. */
  shardKey: string;
}

/** Selection filter. Both bounds on `created_at` are inclusive. */
export interface TransferFilter {
  since: number;
  until: number;
  /** Only rows with this container tag. Omit for every project plus Personal. */
  projectTag?: string;
}

/** One project group of a preview. User-scope rows group under "Personal". */
export interface TransferGroup {
  name: string;
  tag: string;
  count: number;
}

/**
 * A preview example: the id and the text cut to 160 characters. For the screen
 * only; callers must never log it.
 */
export interface TransferExample {
  id: string;
  text: string;
}

export interface TransferPreview {
  /** Source rows that match the filter. */
  matched: number;
  /** Rows a copy would write: matched minus exact duplicates. */
  toCopy: number;
  /** Exact duplicates the target already holds. */
  duplicates: number;
  groups: TransferGroup[];
  examples: TransferExample[];
}

/** A row ready to write: every stored field plus a usable content vector. */
export interface TransferWriteRow {
  id: string;
  text: string;
  containerTag: string;
  tags?: string;
  type?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: string;
  isPinned: boolean;
  vector: Float32Array;
  tagsVector?: Float32Array;
}

/** A shard the target offers for writes, with the rows it already holds. */
export interface TargetShard {
  key: string;
  vectorCount: number;
}

/** The key of a container tag and text pair, for the duplicate check. */
export function tagTextKey(tag: string, text: string): string {
  return `${tag}\u0000${text}`;
}

/**
 * Reads one space as the transfer source. Read methods must not change the
 * space; the delete and count methods run only in a move's remove step.
 */
export interface SourceReader {
  /**
   * Read the source rows for a filter. The reader may pre-filter in SQL, but
   * the engine applies the exact inclusive bounds and the project filter
   * itself, so the reader must return at least every matching row. Rows whose
   * container tag OMMS cannot parse are left alone by the engine.
   */
  readRows(filter: TransferFilter): Promise<TransferRow[]>;
  /**
   * The model and dimensions recorded in the source shards. Undefined when the
   * shards record no model; the engine then embeds again instead of reusing.
   */
  getEmbeddingInfo(): Promise<EmbeddingInfo | undefined>;
  /** Row counts of the given shards, used to fix counts after a move's deletes. */
  getShardCounts(shardKeys: string[]): Promise<Map<string, number>>;
  /** Delete the ids from one shard in a single transaction. */
  deleteFromShard(shardKey: string, ids: string[]): Promise<void>;
  /** Store a shard's vector count after the engine changed the shard. */
  setShardCount(shardKey: string, count: number): Promise<void>;
}

/** Writes one space as the transfer target. */
export interface TargetWriter {
  /** Every id the target holds, loaded once for the duplicate check. */
  loadExistingIds(): Promise<Set<string>>;
  /** Every container tag and text pair the target holds, as `tagTextKey` keys, loaded once. */
  loadExistingTagTexts(): Promise<Set<string>>;
  /** The target space's embedding settings. */
  getEmbeddingSettings(): Promise<EmbeddingInfo>;
  /**
   * The shard that takes the next rows of one scope group, creating a shard
   * when the scope has none. Must not return a shard with no room left under
   * the capacity the engine was given.
   */
  getWriteShard(scope: TransferScope, scopeHash: string): Promise<TargetShard>;
  /** Insert the rows into the shard in one transaction: all rows or none. */
  insertBatch(shard: TargetShard, rows: TransferWriteRow[]): Promise<void>;
  /** Store the shard's vector count after the engine wrote to it. */
  setShardCount(shardKey: string, count: number): Promise<void>;
  /** Read back which of the ids the target holds; called once per move. */
  findExistingIds(ids: string[]): Promise<Set<string>>;
}

export type TransferFailureStep = "select" | "write" | "check" | "remove";

/** A failed step. The message holds counts, shard keys and ids, never memory text. */
export interface TransferFailure {
  step: TransferFailureStep;
  message: string;
}

/** The outcome of an apply. Counts say how far the transfer got. */
export interface TransferApplyResult {
  ok: boolean;
  mode: TransferMode;
  /** Rows written to the target before any failure. */
  copied: number;
  /** Exact duplicates skipped in the target's favour. */
  skipped: number;
  /** Rows deleted from the source (move only, always after a passed check). */
  removed: number;
  /** How many more (or fewer) rows matched at apply time than at preview time. */
  changedFromPreview: number;
  /** True when at least one row was embedded again instead of reusing its vector. */
  embeddedAgain: boolean;
  /** Copied ids the check could not find in the target (move only). */
  missingIds: string[];
  error?: TransferFailure;
}
