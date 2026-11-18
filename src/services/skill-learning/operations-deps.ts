import type { SkillOperationsDeps } from "../../core/skill-operations.js";
import { skillTurnSettingsFor, type SkillConfigModule } from "./settings-for.js";
import { skillModel } from "./skill-model.js";
import { SkillStore, skillsDbPath } from "./store.js";

/**
 * The wiring point between the live config module and the `skills` operations. The terminal
 * command passes `person` and the host tools pass `agent`. The store is not
 * opened here; reads never create `skills.db`.
 */
export function skillOperationsDeps(
  directory: string,
  appliedBy: SkillOperationsDeps["appliedBy"],
  config: SkillConfigModule
): SkillOperationsDeps {
  const settings = skillTurnSettingsFor(directory, config);
  return {
    enabled: settings.enabled,
    store: new SkillStore(skillsDbPath(settings.storagePath)),
    folders: settings.folders,
    model: skillModel(config.CONFIG),
    appliedBy,
  };
}
