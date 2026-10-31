import {
  makeScrubContext,
  SkillFactsError,
  type ChatSkillsDep,
  type SkillRow,
} from "./chat-skills.js";
import { MAX_HISTORY_ENTRIES } from "./chat-skills.js";

/** The settings the skill reader needs. The caller passes `CONFIG`. */
export interface ChatSkillsConfig {
  storagePath: string;
  skillLearning?: boolean;
  skillStoragePath?: string;
  skillFolders?: string[];
  claudeConfigDir?: string;
  memoryApiKey?: string;
  embeddingApiKey?: string;
  webServerApiToken?: string;
  webServerAuthPassword?: string;
}

/**
 * The skill reader for the chat, or undefined while `skillLearning` is off.
 * It opens `skills.db` with `existingDb()` and never calls `init()`, so it
 * never creates or changes the file. A newer schema version is an error.
 */
export async function chatSkillsDep(config: ChatSkillsConfig): Promise<ChatSkillsDep | undefined> {
  if (config.skillLearning !== true) return undefined;
  const [{ SkillStore, skillsDbPath, SKILL_SCHEMA_VERSION }, folders, indexModule, ranking, hist] =
    await Promise.all([
      import("../skill-learning/store.js"),
      import("../skill-learning/skill-folders.js"),
      import("../skill-learning/skill-index.js"),
      import("../skill-learning/ranking.js"),
      import("../skill-learning/history.js"),
    ]);
  const store = new SkillStore(skillsDbPath(folders.skillStoragePath(config)));
  const watched = folders.watchedSkillFolders(config);
  return {
    scrub: makeScrubContext(config),
    rank: async () => {
      const db = await store.existingDb();
      if (db) {
        const row = await db.get("SELECT value FROM skill_meta WHERE key = 'schema_version'");
        if (row && Number(row.value) > SKILL_SCHEMA_VERSION) {
          throw new SkillFactsError("newer_schema");
        }
      }
      const now = Date.now();
      return ranking.rankSkills(store, indexModule.getSkillIndex(watched, now), now, "uses");
    },
    history: async (row: SkillRow) =>
      (
        await hist.skillHistory(
          { store, folders: watched },
          { path: row.path ?? undefined, name: row.name },
          MAX_HISTORY_ENTRIES,
          0
        )
      ).entries,
  };
}

/** The names the current ranking lists, or null when the ranking cannot be read. */
export async function listedSkillNames(config: ChatSkillsConfig): Promise<Set<string> | null> {
  const skills = await chatSkillsDep(config);
  if (!skills) return null;
  try {
    return new Set((await skills.rank()).map((row) => row.name));
  } catch {
    return null;
  }
}
