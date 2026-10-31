import type { ChatRuntimeConfig } from "../chat/chat-runtime.js";
import { skillReviewLease, startAutoReviewLoop, type AutoReviewDeps } from "./auto-review.js";
import { skillStoragePath, watchedSkillFolders } from "./skill-folders.js";
import { getSkillIndex } from "./skill-index.js";
import { skillModel } from "./skill-model.js";
import { SkillStore, skillsDbPath } from "./store.js";

/** The settings the web app's review loop reads. The caller passes a getter for `CONFIG`. */
export interface WebSkillReviewConfig extends ChatRuntimeConfig {
  skillLearning?: boolean;
  skillFolders?: string[];
  claudeConfigDir?: string;
  skillStoragePath?: string;
}

type Opened = Pick<AutoReviewDeps, "store" | "lease">;

let stopLoop: (() => void) | null = null;
const opened = new Map<string, Promise<Opened>>();

/** The store and lease for this storage path, initialised once. */
function openStore(storagePath: string): Promise<Opened> {
  let entry = opened.get(storagePath);
  if (!entry) {
    const store = new SkillStore(skillsDbPath(storagePath));
    entry = store.init().then(() => ({ store, lease: skillReviewLease(store) }));
    entry.catch(() => opened.delete(storagePath));
    opened.set(storagePath, entry);
  }
  return entry;
}

/**
 * The deps for each tick. `getConfig` is called at the start of every tick,
 * because a config reload replaces the `CONFIG` object: a saved Settings
 * change then takes effect without a restart. Null while skill learning is
 * off or before any turn is recorded; `skills.db` is never created here.
 */
export function webReviewDeps(
  getConfig: () => WebSkillReviewConfig
): () => Promise<AutoReviewDeps | null> {
  return async () => {
    const config = getConfig();
    if (!config.skillLearning) return null;
    const storagePath = skillStoragePath(config);
    if (!opened.has(storagePath)) {
      const probe = new SkillStore(skillsDbPath(storagePath));
      if (!(await probe.existingDb())) return null;
    }
    const folders = watchedSkillFolders(config);
    const { store, lease } = await openStore(storagePath);
    return { store, lease, folders, index: getSkillIndex(folders), model: skillModel(config) };
  };
}

/** Starts the automatic skill review in the web app that owns the port. Once per process. */
export function startWebSkillReview(getConfig: () => WebSkillReviewConfig): void {
  stopLoop ??= startAutoReviewLoop(webReviewDeps(getConfig));
}
