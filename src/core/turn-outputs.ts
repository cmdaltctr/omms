import { log } from "../services/logger.js";
import { captureConversation, type CaptureResult, type CaptureWorkUnit } from "./capture.js";
import type { CaptureSummaryProvider } from "./host.js";

/** Which outputs a finished turn goes to. */
export interface TurnOutputs {
  memories: boolean;
  skills: boolean;
}

export interface TurnOutputDeps {
  /** The capture model. Needed when `memories` is on. */
  provider?: CaptureSummaryProvider;
  /**
   * The skill-turn output. Injected so `src/core/` imports nothing from
   * `skill-learning`; the live sites build it from `skillTurnRecorder`.
   */
  recordSkillTurn?: (unit: CaptureWorkUnit) => Promise<unknown>;
}

/** The memory result, or `not-run` when the memory output was off for this turn. */
export type TurnMemoryResult = CaptureResult | { status: "not-run" };

/**
 * The one path for a finished turn (design decision 3). The skill output runs
 * first and only logs its failures. The memory output is `captureConversation`
 * unchanged: same result, same errors.
 */
export function handleFinishedTurn(
  unit: CaptureWorkUnit,
  outputs: { memories: true; skills: boolean },
  deps: TurnOutputDeps
): Promise<CaptureResult>;
export function handleFinishedTurn(
  unit: CaptureWorkUnit,
  outputs: TurnOutputs,
  deps: TurnOutputDeps
): Promise<TurnMemoryResult>;
export async function handleFinishedTurn(
  unit: CaptureWorkUnit,
  outputs: TurnOutputs,
  deps: TurnOutputDeps
): Promise<TurnMemoryResult> {
  if (outputs.skills && deps.recordSkillTurn) {
    try {
      await deps.recordSkillTurn(unit);
    } catch (error) {
      // Codes only: the error may quote turn text.
      log(
        "Skill turn record failed",
        {
          host: unit.host,
          code: "skill-record-failed",
          error: error instanceof Error ? error.name : "unknown",
        },
        "warn"
      );
    }
  }
  if (!outputs.memories) return { status: "not-run" };
  if (!deps.provider) throw new Error("handleFinishedTurn needs a provider for memories");
  return captureConversation(unit, deps.provider);
}
