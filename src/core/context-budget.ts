import { truncateToMaxBytes, utf8ByteLength } from "../utils/context-limit.js";

/**
 * Default approximate-token budget for automatically injected memory context.
 * Hosts pass their snapshotted `CONFIG.retrievalMaxTokens` explicitly; this
 * numeric default keeps the shared formatters host-neutral.
 */
export const DEFAULT_RETRIEVAL_MAX_TOKENS = 2000;

// Must match the default marker in src/utils/context-limit.ts: the packer needs
// its byte size to reserve room for a visible omission marker.
const DEFAULT_TRUNCATION_MARKER = "\n[... truncated ...]\n";

/** Approximate token estimate: ceil(UTF-8 byte length / 4). Never provider-exact. */
export function estimateTokens(text: string): number {
  return Math.ceil(utf8ByteLength(text) / 4);
}

/** Internal UTF-8 byte ceiling for an approximate-token budget. */
export function tokensToByteCeiling(maxTokens: number): number {
  return maxTokens * 4;
}

/**
 * Budget options every automatic-memory formatter accepts.
 * `maxBytes` is an explicit byte ceiling (a residual allowance shared with
 * other sections in the same host request) and wins over `maxTokens`.
 * `wrapperBytes` reserves the bytes of a host wrapper, such as the
 * `omms-retrieval` tag, added around the emitted section.
 */
export interface ContextBudgetOptions {
  maxTokens?: number;
  maxBytes?: number;
  wrapperBytes?: number;
}

/** One variable-content entry: fixed delimiters around a body that may be shortened. */
export interface BudgetedEntry {
  prefix: string;
  body: string;
  suffix: string;
}

/**
 * A group of entries wrapped in fixed delimiters, such as the profile block or
 * the `<project_knowledge>` block. `maxShare` caps the block at a fraction of
 * the payload space left after fixed formatting; the profile uses 0.25.
 */
export interface BudgetedBlock {
  prefix: string;
  suffix: string;
  /** Separator emitted before every entry, including the first. */
  entrySeparator?: string;
  /** Separator emitted between the last entry and the block suffix. */
  suffixSeparator?: string;
  entries: BudgetedEntry[];
  maxShare?: number;
}

export interface PackContextSectionOptions extends ContextBudgetOptions {
  /** Fixed section header emitted before all payload blocks. */
  header: string;
  /** Fixed section footer emitted after all payload blocks. */
  footer?: string;
  /** Separator between payload blocks. */
  blockSeparator?: string;
  /** Payload blocks in emission order: profile first, then memories. */
  blocks: BudgetedBlock[];
  /** Visible omission marker used when shortening a body. */
  marker?: string;
}

export interface PackedSection {
  /** Assembled section text; empty when no useful content fits the budget. */
  text: string;
  /** UTF-8 bytes of `text` (the host wrapper is not part of `text`). */
  bytesUsed: number;
}

function resolveCeiling(options: ContextBudgetOptions): number {
  if (options.maxBytes !== undefined) return options.maxBytes;
  return tokensToByteCeiling(options.maxTokens ?? DEFAULT_RETRIEVAL_MAX_TOKENS);
}

/**
 * Pack payload blocks into a section that fits one byte ceiling.
 *
 * Fixed headers, footers, delimiters, and the host wrapper are reserved before
 * any payload space is assigned. Blocks with `maxShare` (the profile) are
 * shortened inside their share and never take more; space they leave unused
 * stays available to later blocks. Entries keep their incoming order: each is
 * kept whole while it fits, the first oversized entry is shortened with a
 * visible marker and packing stops there, and later entries never displace it.
 * The assembled text contains only complete delimiters and valid Unicode, and
 * `bytesUsed + wrapperBytes` never exceeds the ceiling.
 */
export function packContextSection(options: PackContextSectionOptions): PackedSection {
  const marker = options.marker ?? DEFAULT_TRUNCATION_MARKER;
  const markerBytes = utf8ByteLength(marker);
  const wrapperBytes = options.wrapperBytes ?? 0;
  const blockSeparator = options.blockSeparator ?? "";

  const payload =
    resolveCeiling(options) -
    wrapperBytes -
    utf8ByteLength(options.header) -
    utf8ByteLength(options.footer ?? "");
  if (payload <= 0) return { text: "", bytesUsed: 0 };

  const emittedBlocks: string[] = [];
  let used = 0;

  for (const block of options.blocks) {
    const separatorBytes = emittedBlocks.length > 0 ? utf8ByteLength(blockSeparator) : 0;
    let blockBudget = payload - used - separatorBytes;
    if (block.maxShare !== undefined) {
      blockBudget = Math.min(blockBudget, Math.floor(payload * block.maxShare));
    }
    if (blockBudget <= 0) break;

    const emittedEntries: string[] = [];
    const entrySeparator = block.entrySeparator ?? "";
    const entrySeparatorBytes = utf8ByteLength(entrySeparator);
    const suffixSeparator = block.suffixSeparator ?? "";
    let blockUsed =
      utf8ByteLength(block.prefix) + utf8ByteLength(block.suffix) + utf8ByteLength(suffixSeparator);

    for (const entry of block.entries) {
      const available = blockBudget - blockUsed - entrySeparatorBytes;
      if (available <= 0) break;

      const entryFixed = utf8ByteLength(entry.prefix) + utf8ByteLength(entry.suffix);
      const bodyBytes = utf8ByteLength(entry.body);
      if (entryFixed + bodyBytes <= available) {
        emittedEntries.push(entry.prefix + entry.body + entry.suffix);
        blockUsed += entrySeparatorBytes + entryFixed + bodyBytes;
        continue;
      }

      // First oversized entry: shorten its body with a visible marker, then stop.
      const bodyAllowance = available - entryFixed;
      if (bodyAllowance <= markerBytes) break; // no room for content plus marker
      const shortened = truncateToMaxBytes(entry.body, bodyAllowance, marker);
      if (shortened.length === 0 || shortened === marker) break;
      emittedEntries.push(entry.prefix + shortened + entry.suffix);
      blockUsed += entrySeparatorBytes + entryFixed + utf8ByteLength(shortened);
      break;
    }

    if (emittedEntries.length === 0) continue; // drop the block; it owes no separator

    const blockText =
      block.prefix +
      emittedEntries.map((entry) => entrySeparator + entry).join("") +
      suffixSeparator +
      block.suffix;
    emittedBlocks.push(blockText);
    used += separatorBytes + blockUsed;
  }

  if (emittedBlocks.length === 0) return { text: "", bytesUsed: 0 };

  const text = options.header + emittedBlocks.join(blockSeparator) + (options.footer ?? "");
  const bytesUsed = utf8ByteLength(text);
  return { text, bytesUsed };
}
