import { log } from "../logger.js";
import { userPromptManager } from "../user-prompt/user-prompt-manager.js";
import { loadMemoryRows } from "../web-memory-rows.js";
import { ensureMemoryStoreReady } from "../storage/memory/shards.js";
import {
  getProjectPathFromTag,
  safeJSONParse,
  safeToISOString,
  type ApiResponse,
  type PaginatedResponse,
} from "./shared.js";

interface Memory {
  id: string;
  content: string;
  type?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
}

export async function handleListMemories(
  tag?: string,
  page: number = 1,
  pageSize: number = 20,
  includePrompts: boolean = true,
  keyword?: string
): Promise<ApiResponse<PaginatedResponse<Memory | any>>> {
  try {
    await ensureMemoryStoreReady();
    // Listing only reads SQLite rows; no vector ops happen here.
    // See handleListTags comment - keep embedding init out of read paths.
    const allMemories = await loadMemoryRows(tag);

    const memoriesWithType = allMemories.map((r: any) => {
      const metadata = safeJSONParse(r.metadata);
      return {
        type: "memory",
        id: r.id,
        content: r.content,
        memoryType: r.type,
        tags: r.tags ? r.tags.split(",").map((t: string) => t.trim()) : [],
        createdAt: Number(r.created_at),
        updatedAt: r.updated_at ? Number(r.updated_at) : undefined,
        metadata,
        linkedPromptId: metadata?.promptId,
        displayName: r.display_name,
        userName: r.user_name,
        userEmail: r.user_email,
        projectPath: r.project_path,
        projectName: r.project_name,
        gitRepoUrl: r.git_repo_url,
        isPinned: r.is_pinned === 1,
      };
    });

    // A keyword filter keeps memories carrying that keyword (case-insensitive)
    // and only the prompts linked to them.
    const wanted = keyword?.trim().toLowerCase();
    const keptMemories = wanted
      ? memoriesWithType.filter((m) => m.tags.some((t: string) => t.toLowerCase() === wanted))
      : memoriesWithType;
    const keptIds = new Set(keptMemories.map((m) => m.id));

    let timeline: any[] = keptMemories;
    if (includePrompts) {
      const projectPath = tag ? await getProjectPathFromTag(tag) : undefined;
      const prompts = await userPromptManager.getCapturedPrompts(projectPath);
      const visiblePrompts = wanted
        ? prompts.filter((p) => p.linkedMemoryId && keptIds.has(p.linkedMemoryId))
        : prompts;
      const promptsWithType = visiblePrompts.map((p) => ({
        type: "prompt",
        id: p.id,
        sessionId: p.sessionId,
        content: p.content,
        createdAt: p.createdAt,
        projectPath: p.projectPath,
        linkedMemoryId: p.linkedMemoryId,
      }));
      timeline = [...keptMemories, ...promptsWithType];
    }

    // Pair by the prompt row's linked_memory_id. Capture writes it for every
    // host. A memory's metadata.promptId holds the host message ID for newer
    // captures, so it matches a prompt row ID only on older rows.
    const memoriesById = new Map<string, any>();
    for (const item of timeline) if (item.type === "memory") memoriesById.set(item.id, item);
    const promptsById = new Map<string, any>();
    for (const item of timeline) if (item.type === "prompt") promptsById.set(item.id, item);

    const paired = new Set<any>();
    const units: Array<{ createdAt: number; items: any[] }> = [];
    const addPair = (memory: any, prompt: any) => {
      paired.add(memory);
      paired.add(prompt);
      memory.linkedPromptId = prompt.id;
      units.push({ createdAt: memory.createdAt, items: [memory, prompt] });
    };
    for (const prompt of promptsById.values()) {
      const memory = prompt.linkedMemoryId && memoriesById.get(prompt.linkedMemoryId);
      if (memory && !paired.has(memory)) addPair(memory, prompt);
    }
    for (const memory of memoriesById.values()) {
      const prompt = memory.linkedPromptId && promptsById.get(memory.linkedPromptId);
      if (!paired.has(memory) && prompt && !paired.has(prompt)) addPair(memory, prompt);
    }
    // A memory or prompt whose counterpart is missing (linked prompt deleted,
    // or prompt capture off) must still show up in the timeline, unlinked.
    for (const item of timeline) {
      if (!paired.has(item)) units.push({ createdAt: item.createdAt, items: [item] });
    }
    units.sort((a, b) => b.createdAt - a.createdAt);
    timeline = units.flatMap((unit) => unit.items);

    const total = timeline.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const paginatedResults = timeline.slice(offset, offset + pageSize);

    const items = paginatedResults.map((item: any) => {
      if (item.type === "memory") {
        return {
          type: "memory",
          id: item.id,
          content: item.content,
          memoryType: item.memoryType,
          tags: item.tags,
          createdAt: safeToISOString(item.createdAt),
          updatedAt: item.updatedAt ? safeToISOString(item.updatedAt) : undefined,
          metadata: item.metadata,
          linkedPromptId: item.linkedPromptId,
          displayName: item.displayName,
          userName: item.userName,
          userEmail: item.userEmail,
          projectPath: item.projectPath,
          projectName: item.projectName,
          gitRepoUrl: item.gitRepoUrl,
          isPinned: item.isPinned,
        };
      } else {
        return {
          type: "prompt",
          id: item.id,
          sessionId: item.sessionId,
          content: item.content,
          createdAt: safeToISOString(item.createdAt),
          projectPath: item.projectPath,
          linkedMemoryId: item.linkedMemoryId,
        };
      }
    });

    return { success: true, data: { items, total, page, pageSize, totalPages } };
  } catch (error) {
    log("handleListMemories: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}
