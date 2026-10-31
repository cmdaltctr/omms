import { CONFIG, refreshConfigIfChanged } from "../../config.js";
import type { CaptureWorkUnit } from "../../core/capture.js";
import { skillStoragePath, watchedSkillFolders } from "./skill-folders.js";
import { recordSkillTurn, type SkillTurnSettings, type SkillTurnStatus } from "./turn-output.js";

/**
 * The wiring point between `CONFIG` and the pure skill-turn output. The live
 * capture sites call it; `turn-output.ts` takes the settings as an argument.
 */

export type SkillTurnRecorder = (unit: CaptureWorkUnit) => Promise<SkillTurnStatus>;

/** The skill-turn settings for a project folder, with its project override applied. */
export function skillTurnSettingsFor(directory: string): SkillTurnSettings {
  refreshConfigIfChanged(directory);
  return {
    enabled: CONFIG.skillLearning === true,
    redact: CONFIG.skillLearningRedact !== false,
    folders: watchedSkillFolders(CONFIG),
    storagePath: skillStoragePath(CONFIG),
    secrets: CONFIG,
  };
}

/** A recorder for turns in this folder, or undefined when skill learning is off there. */
export function skillTurnRecorder(directory: string): SkillTurnRecorder | undefined {
  const settings = skillTurnSettingsFor(directory);
  if (!settings.enabled) return undefined;
  return (unit) => recordSkillTurn(unit, settings);
}
