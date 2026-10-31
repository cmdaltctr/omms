import type { CaptureWorkUnit } from "../../core/capture.js";
import { redactTraceText, type CaptureDiagnosticsConfig } from "../capture-diagnostics.js";
import { log } from "../logger.js";
import { isFullyPrivate } from "../privacy.js";
import { getTags } from "../tags.js";
import { detectSkillUses } from "./skill-detect.js";
import { getSkillIndex } from "./skill-index.js";
import { SkillStore, skillsDbPath, type SkillTurnRecord } from "./store.js";

/**
 * The resolved settings for one turn. The caller reads them from `CONFIG` for
 * the turn's project (`settings-for.ts`), so this module never imports it.
 */
export interface SkillTurnSettings {
  /** `skillLearning` after the project override. */
  enabled: boolean;
  /** `skillLearningRedact`. */
  redact: boolean;
  /** `skillFolders`, or the default folders when it is unset. */
  folders: string[];
  storagePath: string;
  /** The configured secrets that `redactTraceText` removes. */
  secrets: CaptureDiagnosticsConfig;
}

export type SkillTurnStatus = "disabled" | "private" | "new" | "duplicate";

// One initialised store for each file, shared by every turn.
const stores = new Map<string, Promise<SkillStore>>();

function storeFor(storagePath: string): Promise<SkillStore> {
  const path = skillsDbPath(storagePath);
  let store = stores.get(path);
  if (!store) {
    const created = new SkillStore(path);
    store = created.init().then(() => created);
    // A failed open is tried again on the next turn.
    store.catch(() => stores.delete(path));
    stores.set(path, store);
  }
  return store;
}

/**
 * The turn's identity in `skills.db`: host, session and the host's id for the
 * user message. Live capture and history import build the same key.
 */
export function skillTurnKey(unit: CaptureWorkUnit): string {
  return `${unit.host}:${unit.hostSessionId}:${unit.promptId}`;
}

function buildRecord(unit: CaptureWorkUnit, settings: SkillTurnSettings): SkillTurnRecord {
  // redactTraceText removes `<private>` text first, then secrets.
  const clean = (text: string) =>
    settings.redact ? redactTraceText(text, settings.secrets) : text;
  const project = getTags(unit.projectDirectory).project;
  // Detection reads the unredacted calls, so a redacted path still matches.
  const skillUses = detectSkillUses(
    { prompt: unit.userPrompt, toolCalls: unit.toolCalls },
    getSkillIndex(settings.folders)
  );
  return {
    turnKey: skillTurnKey(unit),
    host: unit.host,
    sessionId: unit.hostSessionId,
    projectTag: project.tag,
    projectName: project.projectName ?? null,
    provider: unit.prompt?.providerId ?? null,
    model: unit.prompt?.modelId ?? null,
    createdAt: unit.sourceTimestamp ?? Date.now(),
    prompt: clean(unit.userPrompt),
    replies: unit.textResponses.map(clean),
    redacted: settings.redact,
    toolCalls: unit.toolCalls.map((call) => ({
      name: call.name,
      input: clean(call.input),
      outcome: call.outcome ?? "unknown",
      error: call.error === undefined ? null : clean(call.error),
    })),
    skillUses,
  };
}

function storedChars(record: SkillTurnRecord): number {
  let chars = record.prompt.length;
  for (const reply of record.replies) chars += reply.length;
  for (const call of record.toolCalls) chars += call.input.length + (call.error?.length ?? 0);
  return chars;
}

/**
 * Records one finished turn into `skills.db` (ADR-035). Off: returns at once
 * and never opens the file. The log record holds counts and sizes only.
 * Errors are thrown; `handleFinishedTurn` catches them.
 */
export async function recordSkillTurn(
  unit: CaptureWorkUnit,
  settings: SkillTurnSettings
): Promise<SkillTurnStatus> {
  if (!settings.enabled) return "disabled";
  if (settings.redact && isFullyPrivate(unit.userPrompt)) {
    log("Skill turn skipped", { host: unit.host, code: "private" });
    return "private";
  }
  const record = buildRecord(unit, settings);
  const store = await storeFor(settings.storagePath);
  const status = (await store.insertTurn(record)) ? "new" : "duplicate";
  log("Skill turn recorded", {
    host: unit.host,
    toolCalls: record.toolCalls.length,
    chars: storedChars(record),
    result: status,
  });
  return status;
}

/**
 * What `recordSkillTurn` would return, for a dry run. Read-only: a missing
 * `skills.db` stays missing.
 */
export async function peekSkillTurn(
  unit: CaptureWorkUnit,
  settings: SkillTurnSettings
): Promise<SkillTurnStatus> {
  if (!settings.enabled) return "disabled";
  if (settings.redact && isFullyPrivate(unit.userPrompt)) return "private";
  const store = new SkillStore(skillsDbPath(settings.storagePath));
  return (await store.hasTurn(skillTurnKey(unit))) ? "duplicate" : "new";
}
