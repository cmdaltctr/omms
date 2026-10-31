import { CONFIG } from "../../config.js";
import type { SkillOperationsDeps } from "../../core/skill-operations.js";
import { skillTurnSettingsFor } from "./settings-for.js";
import { skillModel } from "./skill-model.js";
import { SkillStore, skillsDbPath } from "./store.js";

/**
 * The wiring point between `CONFIG` and the `skills` operations. The terminal
 * command passes `person` and the host tools pass `agent`. The store is not
 * opened here; reads never create `skills.db`.
 */
export function skillOperationsDeps(
  directory: string,
  appliedBy: SkillOperationsDeps["appliedBy"]
): SkillOperationsDeps {
  const settings = skillTurnSettingsFor(directory);
  return {
    enabled: settings.enabled,
    store: new SkillStore(skillsDbPath(settings.storagePath)),
    folders: settings.folders,
    model: skillModel(CONFIG),
    appliedBy,
  };
}
