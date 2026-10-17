/**
 * The embedder-dependent default for similarityThreshold (openspec change
 * retrieval-threshold-and-reranker). Pure function: callers pass the model
 * name, so config.ts, the settings writer, and the settings snapshot share
 * one table without importing CONFIG. Do not import CONFIG here: many tests
 * stub src/config.js with a partial module.
 *
 * Evidence: 0.5 was measured with qwen3-embedding:0.6b only (Experiments 24
 * to 26). Other embedders keep the historical 0.6 until someone measures
 * them and adds a line to the list below.
 */

const MEASURED_THRESHOLD_0_5 = new Set([
  "qwen3-embedding:0.6b",
  "qwen/qwen3-embedding-0.6b",
  "qwen/qwen3-embedding-0.6b-gguf:q8_0",
]);

const UNMEASURED_THRESHOLD = 0.6;

export function defaultSimilarityThreshold(embeddingModel: string | undefined): number {
  if (!embeddingModel) return UNMEASURED_THRESHOLD;
  return MEASURED_THRESHOLD_0_5.has(embeddingModel.toLowerCase()) ? 0.5 : UNMEASURED_THRESHOLD;
}
