import { CONFIG, isConfigured } from "../config.js";
import { memoryClient, type MemoryScope } from "../services/client.js";
import { getLanguageName } from "../services/language-detector.js";
import { stripPrivateContent, isFullyPrivate } from "../services/privacy.js";
import { getTags } from "../services/tags.js";
import type { MemoryHost, MemoryType } from "../types/index.js";

export type MemoryOperationMode =
  | "add"
  | "search"
  | "profile"
  | "list"
  | "forget"
  | "help"
  | "migrate"
  | "list-shards"
  | "export"
  | "import";

export interface MemoryOperationArgs {
  mode?: MemoryOperationMode;
  content?: string;
  query?: string;
  tags?: string;
  type?: MemoryType;
  memoryId?: string;
  limit?: number;
  scope?: MemoryScope;
  fromPath?: string;
  fromHash?: string;
  outputPath?: string;
  inputPath?: string;
  dryRun?: boolean;
  allowLinkedSource?: boolean;
}

export interface MemoryOperationContext {
  directory: string;
  tags?: ReturnType<typeof getTags>;
  host?: MemoryHost;
  hostSessionId?: string;
}

function formatSearchResults(query: string, results: any, limit?: number) {
  const memoryResults = results.results || [];
  return {
    success: true,
    query,
    count: memoryResults.length,
    results: memoryResults.slice(0, limit || 10).map((result: any) => ({
      id: result.id,
      content: result.memory || result.chunk,
      similarity: Math.round(result.similarity * 100),
    })),
  };
}

export async function executeMemoryOperation(
  args: MemoryOperationArgs,
  context: MemoryOperationContext
): Promise<Record<string, unknown>> {
  if (!isConfigured()) {
    return {
      success: false,
      error: "Memory system not configured properly.",
    };
  }

  const mode = args.mode || "help";
  const needsEmbedding = !["help", "list-shards", "migrate", "export"].includes(mode);

  if (needsEmbedding) {
    const embeddingInitError = memoryClient.getEmbeddingInitError?.();
    if (embeddingInitError) {
      return { success: false, error: embeddingInitError };
    }
  }

  try {
    if (needsEmbedding) {
      await memoryClient.warmup();
    } else if (mode !== "help") {
      await memoryClient.ensureStorageReady();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Memory system failed to initialize: ${message}`,
    };
  }

  const tags = context.tags ?? getTags(context.directory);
  const langName = getLanguageName(CONFIG.autoCaptureLanguage || "en");

  try {
    switch (mode) {
      case "help":
        return {
          success: true,
          message: "Memory System Usage Guide",
          commands: [
            {
              command: "add",
              description: `Store new memory (MATCH USER LANGUAGE: ${langName})`,
              args: ["content", "type?", "tags?"],
            },
            {
              command: "search",
              description: `Search memories via keywords (MATCH USER LANGUAGE: ${langName})`,
              args: ["query"],
            },
            {
              command: "profile",
              description:
                "View user profile or save an explicit preference (provide content to write)",
              args: ["content?"],
            },
            { command: "list", description: "List recent memories", args: ["limit?"] },
            { command: "forget", description: "Remove memory", args: ["memoryId"] },
            {
              command: "list-shards",
              description: "List project memory shards and orphaned path associations",
              args: [],
            },
            {
              command: "migrate",
              description:
                "Reassociate orphaned project shards after a directory move (target must be empty)",
              args: ["fromPath?", "fromHash?", "dryRun?", "allowLinkedSource?"],
            },
            {
              command: "export",
              description: "Export current project memories to a portable JSON file",
              args: ["outputPath"],
            },
            {
              command: "import",
              description:
                "Import memories from a portable JSON file (re-embeds; aborts on duplicate ids)",
              args: ["inputPath", "dryRun?"],
            },
          ],
          tagGuidance: "Use technical keywords for search. Tags rank highest.",
        };

      case "add": {
        if (!args.content) return { success: false, error: "content required" };
        const sanitizedContent = stripPrivateContent(args.content);
        if (isFullyPrivate(args.content)) {
          return { success: false, error: "Private content blocked" };
        }

        const tagInfo = tags.project;
        const parsedTags = args.tags
          ? args.tags.split(",").map((tag) => tag.trim().toLowerCase())
          : undefined;
        const result = await memoryClient.addMemory(sanitizedContent, tagInfo.tag, {
          type: args.type,
          tags: parsedTags,
          host: context.host,
          hostSessionId: context.hostSessionId,
          displayName: tagInfo.displayName,
          userName: tagInfo.userName,
          userEmail: tagInfo.userEmail,
          projectPath: tagInfo.projectPath,
          projectName: tagInfo.projectName,
          gitRepoUrl: tagInfo.gitRepoUrl,
        });

        return {
          success: result.success,
          message: result.success ? "Memory added" : result.error,
          id: result.success ? result.id : undefined,
          tags: parsedTags,
        };
      }

      case "search": {
        if (!args.query) return { success: false, error: "query required" };
        const result = await memoryClient.searchMemories(
          args.query,
          tags.project.tag,
          args.scope ?? CONFIG.memory.defaultScope
        );
        if (!result.success) return { success: false, error: result.error };
        return formatSearchResults(args.query, result, args.limit);
      }

      case "profile": {
        if (args.query) {
          return {
            success: false,
            error:
              "query is not valid for profile mode. Use content to write a preference or omit all args to read.",
          };
        }

        const { userProfileManager } =
          await import("../services/user-profile/user-profile-manager.js");
        const userId = tags.user.userEmail || "unknown";

        if (args.content !== undefined) {
          const trimmed = args.content.trim();
          if (!trimmed) return { success: false, error: "content must not be blank" };

          if (!tags.user.userEmail) {
            return {
              success: false,
              error:
                "Cannot save profile preference because no user email could be resolved. Configure userEmailOverride or git user.email.",
            };
          }

          const sanitizedContent = stripPrivateContent(trimmed);
          const hasNonPrivateContent =
            sanitizedContent.replace(/\[REDACTED\]/g, "").trim().length > 0;

          if (isFullyPrivate(trimmed) || !hasNonPrivateContent) {
            return { success: false, error: "Private content blocked" };
          }

          const newPreference = {
            category: "explicit",
            description: sanitizedContent,
            confidence: 1.0,
            frequency: 1,
            evidence: ["manual-write"],
            lastSeen: Date.now(),
          };

          const existingProfile = await userProfileManager.getActiveProfile(userId);
          if (existingProfile) {
            const existingData = JSON.parse(existingProfile.profileData);
            const mergedData = await userProfileManager.mergeProfileData(
              existingData,
              { preferences: [newPreference] },
              undefined,
              existingProfile.id
            );
            await userProfileManager.updateProfile(
              existingProfile.id,
              mergedData,
              0,
              `Explicit preference added: ${sanitizedContent.slice(0, 80)}`
            );
            return { success: true, message: "Preference saved to profile" };
          }

          await userProfileManager.createProfile(
            userId,
            tags.user.displayName || userId,
            tags.user.userName || userId,
            tags.user.userEmail || userId,
            { preferences: [newPreference], patterns: [], workflows: [] },
            0
          );
          return { success: true, message: "Profile created with preference" };
        }

        const profile = await userProfileManager.getActiveProfile(userId);
        if (!profile) return { success: true, profile: null };
        const profileData = JSON.parse(profile.profileData);
        return {
          success: true,
          profile: {
            ...profileData,
            version: profile.version,
            lastAnalyzed: profile.lastAnalyzedAt,
          },
        };
      }

      case "list": {
        const result = await memoryClient.listMemories(
          tags.project.tag,
          args.limit || 20,
          args.scope ?? CONFIG.memory.defaultScope
        );
        if (!result.success) return { success: false, error: result.error };
        return {
          success: true,
          count: result.memories?.length,
          memories: result.memories?.map((memory: any) => ({
            id: memory.id,
            content: memory.summary,
            createdAt: memory.createdAt,
          })),
        };
      }

      case "forget": {
        if (!args.memoryId) return { success: false, error: "memoryId required" };
        const result = await memoryClient.deleteMemory(args.memoryId);
        return { success: result.success, message: "Memory removed" };
      }

      case "list-shards":
        return { ...(await memoryClient.listShards(context.directory)) };

      case "migrate": {
        if (!args.fromPath && !args.fromHash) {
          return {
            success: false,
            error:
              "fromPath or fromHash required. Run memory list-shards to discover orphaned shards.",
          };
        }
        return {
          ...(await memoryClient.migrateProjectPath({
            currentDirectory: context.directory,
            fromPath: args.fromPath,
            fromHash: args.fromHash,
            dryRun: args.dryRun,
            allowLinkedSource: args.allowLinkedSource,
          })),
        };
      }

      case "export": {
        if (!args.outputPath) return { success: false, error: "outputPath required" };
        return { ...(await memoryClient.exportMemories(context.directory, args.outputPath)) };
      }

      case "import": {
        if (!args.inputPath) return { success: false, error: "inputPath required" };
        return {
          ...(await memoryClient.importMemories(context.directory, args.inputPath, args.dryRun)),
        };
      }
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
