import { CONFIG } from "../config.js";
import type { CaptureWorkUnit } from "../core/capture.js";
import { handleFinishedTurn } from "../core/turn-outputs.js";
import { skillTurnSettingsFor } from "../services/skill-learning/settings-for.js";
import {
  peekSkillTurn,
  recordSkillTurn,
  type SkillTurnSettings,
  type SkillTurnStatus,
} from "../services/skill-learning/turn-output.js";
import type { MemoryHost } from "../types/index.js";
import type { ImportWindow } from "./importer.js";

/**
 * The outputs of one imported turn (design decision 11). Skill turns run
 * first for every candidate, before the memory ledger is read, so turns the
 * ledger or live capture already handled still reach `skills.db`.
 */

/** Skill-turn counts on an import report. Present only when the run records skill turns. */
export interface ImportSkillTurnCounts {
  /** Real run: turns written to `skills.db`. */
  skillTurnsRecorded?: number;
  /** Real run: turns `skills.db` already held. */
  skillTurnsAlreadyPresent?: number;
  /** Dry run: turns a real run would write. */
  skillTurnsWouldRecord?: number;
  /** Dry run: turns `skills.db` already holds. */
  skillTurnsAlreadyRecorded?: number;
}

/** True when an import with these options records skill turns: `skillLearning` on and no `--skip-skills`. */
export function importSkillTurnsOn(options: { skipSkills?: boolean }): boolean {
  return options.skipSkills !== true && CONFIG.skillLearning === true;
}

/**
 * True when a run writes skill turns and nothing else (`profile`: the run also
 * learns the profile). Such a run also reads sessions whose project folder is
 * gone; memory and profile runs still skip them.
 */
export function skillTurnsOnly(
  options: { skipMemories?: boolean; skipSkills?: boolean },
  profile: boolean
): boolean {
  return options.skipMemories === true && !profile && importSkillTurnsOn(options);
}

/** The capture work unit for one imported window, shared by the memory and skill outputs. */
export function importWorkUnit(
  host: MemoryHost,
  turn: { sessionId: string; directory: string; sourceFile: string; window: ImportWindow },
  importId: string
): CaptureWorkUnit {
  const { window } = turn;
  return {
    host,
    hostSessionId: turn.sessionId,
    sourceType: "history-import",
    projectDirectory: turn.directory,
    userPrompt: window.userPrompt,
    promptId: window.userEntryId,
    textResponses: window.textResponses,
    toolCalls: window.toolCalls,
    sourceEntryIds: window.sourceEntryIds,
    ...(window.userTimestamp !== undefined
      ? { sourceTimestamp: window.userTimestamp }
      : window.sourceTimestamp !== undefined
        ? { sourceTimestamp: window.sourceTimestamp }
        : {}),
    sourceFile: turn.sourceFile,
    importId,
  };
}

/**
 * The skill output of one run, or undefined when the run records no skill
 * turns. A real run records through `handleFinishedTurn`; a dry run only
 * checks `turn_key` and never creates `skills.db`. Each project folder's
 * settings are read once, with its project override applied.
 */
export function importSkillTurnOutput(
  options: { skipSkills?: boolean; dryRun?: boolean },
  report: ImportSkillTurnCounts
): ((unit: CaptureWorkUnit) => Promise<void>) | undefined {
  if (!importSkillTurnsOn(options)) return undefined;
  const dryRun = Boolean(options.dryRun);
  if (dryRun) {
    report.skillTurnsWouldRecord ??= 0;
    report.skillTurnsAlreadyRecorded ??= 0;
  } else {
    report.skillTurnsRecorded ??= 0;
    report.skillTurnsAlreadyPresent ??= 0;
  }
  const count = (status: SkillTurnStatus) => {
    if (status === "new") {
      if (dryRun) report.skillTurnsWouldRecord!++;
      else report.skillTurnsRecorded!++;
    } else if (status === "duplicate") {
      if (dryRun) report.skillTurnsAlreadyRecorded!++;
      else report.skillTurnsAlreadyPresent!++;
    }
  };
  const settings = new Map<string, SkillTurnSettings>();
  const settingsFor = (directory: string) => {
    let found = settings.get(directory);
    if (!found) {
      found = skillTurnSettingsFor(directory);
      settings.set(directory, found);
    }
    return found;
  };
  const output = dryRun ? peekSkillTurn : recordSkillTurn;
  return async (unit) => {
    const current = settingsFor(unit.projectDirectory);
    if (!current.enabled) return;
    // handleFinishedTurn logs a failure as skill-record-failed, so one bad turn never stops the run.
    await handleFinishedTurn(
      unit,
      { memories: false, skills: true },
      { recordSkillTurn: async (turn) => count(await output(turn, current)) }
    );
    // `skills.db` writes finish without giving the event loop a turn. In the
    // web app, a long run would otherwise hold back every request, progress included.
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
}
