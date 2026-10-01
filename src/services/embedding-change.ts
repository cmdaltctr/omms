import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CONFIG } from "../config.js";
import { EmbeddingService, type EmbedderSettings } from "./embedding.js";
import { log } from "./logger.js";
import {
  MemoryKeySourceError,
  parseMemoryKeySource,
  storeMemoryKeySource,
  type MemoryKeySourceRequest,
} from "./memory-key-source.js";

/** A fixed sentence with no user content. */
const TEST_SENTENCE = "OMMS embedding test sentence.";
const TEST_VALID_MS = 10 * 60 * 1000;

export type EmbeddingKeyChoice = { source: "saved" } | { source: "none" } | MemoryKeySourceRequest;

export interface EmbeddingCandidate {
  kind: "builtin" | "server";
  url?: string;
  model: string;
  key: EmbeddingKeyChoice;
}

export class EmbeddingChangeError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "EmbeddingChangeError";
  }
}

/** Check a candidate's shape; messages never include a pasted key. */
export function parseEmbeddingCandidate(body: unknown): EmbeddingCandidate {
  const value = (body ?? {}) as Record<string, unknown>;
  if (value.kind !== "builtin" && value.kind !== "server") {
    throw new EmbeddingChangeError("Choose Built-in model or OpenAI-compatible server");
  }
  if (typeof value.model !== "string" || !value.model.trim()) {
    throw new EmbeddingChangeError("Enter the model name");
  }
  if (value.kind === "builtin")
    return { kind: "builtin", model: value.model.trim(), key: { source: "none" } };
  const url = typeof value.url === "string" ? value.url.trim().replace(/\/+$/, "") : "";
  if (!/^https?:\/\/\S+$/.test(url)) throw new EmbeddingChangeError("Enter the server URL");
  const key = (value.key ?? { source: "none" }) as Record<string, unknown>;
  const choice: EmbeddingKeyChoice =
    key.source === "saved" || key.source === "none"
      ? { source: key.source }
      : parseMemoryKeySource(key);
  return { kind: "server", url, model: value.model.trim(), key: choice };
}

function resolveKey(choice: EmbeddingKeyChoice): string | undefined {
  switch (choice.source) {
    case "none":
      return undefined;
    case "saved":
      return CONFIG.embeddingApiKey || undefined;
    case "env":
      return process.env[choice.name] || undefined;
    case "file":
      try {
        return readFileSync(choice.path, "utf8").trim() || undefined;
      } catch {
        throw new EmbeddingChangeError("The key file cannot be read");
      }
    case "paste":
      return choice.value.trim();
  }
}

/** Identifies the tested values; a pasted key is hashed, never kept. */
function candidateHash(candidate: EmbeddingCandidate): string {
  const key = candidate.key.source === "paste" ? { ...candidate.key, value: "" } : candidate.key;
  const secret = candidate.key.source === "paste" ? candidate.key.value.trim() : "";
  return createHash("sha256")
    .update(JSON.stringify([candidate.kind, candidate.url ?? "", candidate.model, key, secret]))
    .digest("hex");
}

const passedTests = new Map<string, { dimensions: number; at: number }>();

/** Embed the fixed sentence with a one-off embedder; the shared one is not touched. */
export async function testEmbeddingCandidate(
  candidate: EmbeddingCandidate,
  now = Date.now()
): Promise<{ ok: true; dimensions: number } | { ok: false; reason: string }> {
  let key: string | undefined;
  try {
    key = resolveKey(candidate.key);
    const settings: EmbedderSettings = {
      embeddingApiUrl: candidate.kind === "server" ? candidate.url : undefined,
      embeddingApiKey: candidate.kind === "server" ? key : undefined,
      embeddingModel: candidate.model,
    };
    const vector = await new EmbeddingService(() => settings).embedWithTimeout(TEST_SENTENCE);
    if (!vector.length) return { ok: false, reason: "The embedder returned no values" };
    passedTests.set(candidateHash(candidate), { dimensions: vector.length, at: now });
    return { ok: true, dimensions: vector.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: key ? message.replaceAll(key, "[redacted]") : message };
  }
}

export interface EmbeddingRunState {
  state: "idle" | "running" | "done" | "failed";
  progress: { processed: number; total: number };
  error?: string;
}

let run: EmbeddingRunState = { state: "idle", progress: { processed: 0, total: 0 } };

export function embeddingRunState(): EmbeddingRunState {
  return run;
}

/** The embedder in use and the number of stored memories a change would re-embed. */
export async function currentEmbedding() {
  const { tursoShardManager } = await import("./turso/shard-manager.js");
  const shards = [
    ...(await tursoShardManager.getAllShards("user", "")),
    ...(await tursoShardManager.getAllShards("project", "")),
  ];
  return {
    kind: CONFIG.embeddingApiUrl ? "server" : "builtin",
    url: CONFIG.embeddingApiUrl ?? null,
    model: CONFIG.embeddingModel,
    dimensions: CONFIG.embeddingDimensions,
    memoryCount: shards.reduce((count, shard) => count + shard.vectorCount, 0),
    run,
  };
}

/** Start one re-embed of every out-of-date shard; a second start while one runs is refused. */
export async function startReembed(): Promise<void> {
  const { migrationService } = await import("./migration-service.js");
  if (run.state === "running" || migrationService.getStatus().isRunning) {
    throw new EmbeddingChangeError("A re-embed is already running", 409);
  }
  run = { state: "running", progress: { processed: 0, total: 0 } };
  void migrationService
    .migrateToNewModel("re-embed", (progress) => {
      run.progress = { processed: progress.processed, total: progress.total };
    })
    .then((result) => {
      run = result.success
        ? { state: "done", progress: run.progress }
        : { state: "failed", progress: run.progress, error: result.error ?? "Re-embed failed" };
      log("Embedding re-embed finished", {
        outcome: run.state,
        memories: result.reEmbeddedMemories,
      });
    })
    .catch((error) => {
      run = { state: "failed", progress: run.progress, error: String(error) };
    });
}

/**
 * Save a tested embedder in one config write, then start the re-embed. The
 * candidate must match a passing test from the last 10 minutes.
 */
export async function applyEmbeddingCandidate(
  candidate: EmbeddingCandidate,
  revision: string,
  refreshConfig: () => void,
  now = Date.now()
): Promise<void> {
  if (run.state === "running") throw new EmbeddingChangeError("A re-embed is already running", 409);
  const passed = passedTests.get(candidateHash(candidate));
  if (!passed || now - passed.at > TEST_VALID_MS) {
    throw new EmbeddingChangeError("Test these values before you apply them", 409);
  }
  const edits: Record<string, unknown> = {
    embeddingApiUrl: candidate.kind === "server" ? candidate.url : undefined,
    embeddingModel: candidate.model,
    embeddingDimensions: passed.dimensions,
  };
  if (candidate.kind === "builtin" || candidate.key.source === "none") {
    edits.embeddingApiKey = undefined;
  } else if (candidate.key.source !== "saved") {
    edits.embeddingApiKey = (await storeMemoryKeySource(candidate.key)).reference;
  }
  const { EMBEDDING_KEYS, writeGlobalConfigKeys } = await import("./global-config-writer.js");
  await writeGlobalConfigKeys(edits, revision, { only: EMBEDDING_KEYS });
  refreshConfig();
  passedTests.delete(candidateHash(candidate));
  await startReembed();
}

export { MemoryKeySourceError };
