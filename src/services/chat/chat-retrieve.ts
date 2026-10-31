import type { ChatPlanRecord, ChatSource } from "./chat-types.js";

export const MAX_MEMORY_SOURCES = 12;
export const MAX_PROFILE_SOURCES = 6;
/** A profile item outside the chosen categories joins only when it is at least this close. */
export const PROFILE_MIN_SIMILARITY = 0.35;

/** One search result, as `memoryClient.searchMemories` returns it. */
export interface MemoryHit {
  id: string;
  memory: string;
  similarity: number;
  tags?: string[];
  createdAt?: number;
  projectName?: string;
  containerTag?: string;
}

export interface ProfileCandidate {
  section: "preferences" | "patterns" | "workflows";
  index: number;
  category?: string;
  description: string;
  evidence?: string[] | string;
  centroid?: number[];
}

export interface RetrieveDeps {
  /** `scopeTag` null searches every project. */
  searchMemories: (query: string, scopeTag: string | null) => Promise<MemoryHit[]>;
  embed: (text: string) => Promise<ArrayLike<number>>;
  profileItems: () => Promise<ProfileCandidate[]>;
}

/** Sources still need labels; `numberSources` in chat-answer.ts gives them. */
export interface RetrievedSources {
  memories: ChatSource[];
  profile: ChatSource[];
  /** Skill facts. Added by the service while skill facts are on; retrieval never sets it. */
  skills?: ChatSource[];
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function memorySources(
  plan: ChatPlanRecord,
  scopeTag: string | null,
  deps: RetrieveDeps
): Promise<ChatSource[]> {
  const queries = [...plan.queries];
  if (plan.tags.length) queries.push(plan.tags.join(" "));
  const batches = await Promise.all(queries.map((query) => deps.searchMemories(query, scopeTag)));
  const best = new Map<string, MemoryHit>();
  for (const hit of batches.flat()) {
    const seen = best.get(hit.id);
    if (!seen || hit.similarity > seen.similarity) best.set(hit.id, hit);
  }
  return [...best.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_MEMORY_SOURCES)
    .map((hit) => ({
      label: "",
      kind: "memory" as const,
      id: hit.id,
      text: hit.memory,
      projectName: hit.projectName,
      projectTag: hit.containerTag,
      createdAt: hit.createdAt,
      tags: hit.tags,
      score: hit.similarity,
    }));
}

async function profileSources(
  question: string,
  plan: ChatPlanRecord,
  deps: RetrieveDeps
): Promise<ChatSource[]> {
  const items = await deps.profileItems();
  if (items.length === 0) return [];
  const chosen = new Set(plan.profileCategories.map((c) => c.toLowerCase()));
  const vector = items.some((item) => item.centroid) ? await deps.embed(question) : null;
  return items
    .map((item) => {
      const closeness = vector && item.centroid ? cosine(vector, item.centroid) : 0;
      const inCategory = !!item.category && chosen.has(item.category.toLowerCase());
      // Chosen categories rank above everything found by vector alone.
      return { item, closeness, inCategory, rank: (inCategory ? 1 : 0) + closeness };
    })
    .filter((entry) => entry.inCategory || entry.closeness >= PROFILE_MIN_SIMILARITY)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_PROFILE_SOURCES)
    .map(({ item, closeness }) => ({
      label: "",
      kind: "profile" as const,
      id: `${item.section}:${item.index}`,
      text: item.description,
      section: item.section,
      category: item.category,
      evidence: Array.isArray(item.evidence)
        ? item.evidence
        : item.evidence
          ? [item.evidence]
          : undefined,
      score: closeness,
    }));
}

/** Memory and profile sources for one question, searched in parallel. */
export async function retrieveSources(
  question: string,
  plan: ChatPlanRecord,
  scopeTag: string | null,
  deps: RetrieveDeps
): Promise<RetrievedSources> {
  const [memories, profile] = await Promise.all([
    memorySources(plan, scopeTag, deps),
    profileSources(question, plan, deps),
  ]);
  return { memories, profile };
}
