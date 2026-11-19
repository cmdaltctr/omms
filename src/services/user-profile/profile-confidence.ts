import type { CONFIG } from "../../config.js";
import { log } from "../logger.js";

/** The config value the confidence maths reads. Callers pass CONFIG. */
export type ConfidenceConfig = Pick<typeof CONFIG, "userProfileConfidenceDecayDays">;

/**
 * Gamma sampler (Marsaglia-Tsang 2000).
 * Used by sampleBeta for Thompson Sampling weak-hit upgrades.
 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function randn(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
export function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

/**
 * Language-agnostic text normalization for embedding comparison.
 * Strips punctuation and collapses whitespace — the embedding model
 * handles semantic similarity naturally without word-level rules.
 */
export function normalizeDescription(text: string): string {
  return text
    .trim()
    .replace(/[，,。！？；;：:、\n\r.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ensureArray(val: any): any[] {
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      log(
        "ensureArray: failed to parse JSON string, returning []",
        {
          val: String(val).substring(0, 100),
          error: String(e),
        },
        "error"
      );
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}

export function isMilestone(frequency: number): boolean {
  if (frequency <= 20) return [2, 5, 10, 20].includes(frequency);
  return frequency % 20 === 0;
}

export function minEvidenceForEvolve(_itemType: string): number {
  return 4;
}

export function syncConfidence(item: any, config: ConfidenceConfig): void {
  const alpha = item.alpha ?? 1;
  const beta = item.beta ?? 1;
  const betaMean = alpha / (alpha + beta);
  const decayThreshold = config.userProfileConfidenceDecayDays * 24 * 60 * 60 * 1000;
  const freq = item.frequency || 1;
  const halfLife = decayThreshold * (1 + Math.log2(1 + freq));
  const age = Date.now() - (item.lastSeen || Date.now());
  const ageMs = Math.max(0, age - decayThreshold);
  const timeFactor = Math.exp((-Math.LN2 * ageMs) / halfLife);
  const matchTime = item.lastMatchTime || item.lastSeen || Date.now();
  const matchAge = (Date.now() - matchTime) / (24 * 60 * 60 * 1000);
  const trendMultiplier = 0.8 + 0.2 * Math.exp(-matchAge / 30);
  item.confidence = betaMean * Math.min(timeFactor, trendMultiplier);
}

export function lazyMigrateAlpha(item: any, config: ConfidenceConfig): void {
  const needsAlphaMigration = item.alpha === undefined || (item.alpha === 0.5 && item.beta === 1.5);
  if (needsAlphaMigration) {
    const conf = Math.max(0, Math.min(1, item.confidence ?? 1.0));
    item.alpha = conf / (1 - conf + 0.01);
    item.beta = 1;
  }
  item.weakAlpha = item.weakAlpha ?? 1;
  item.weakBeta = item.weakBeta ?? 1;
  item.lastMatchTime = item.lastMatchTime ?? item.lastSeen ?? Date.now();
  item.firstSeen = item.firstSeen ?? item.lastSeen ?? Date.now();
  if (item.pendingValidation === undefined) {
    item.pendingValidation = false;
  }
  syncConfidence(item, config);
}
