/**
 * The Memory card's editable limits: pure definitions and draft maths, with no
 * React, config, or host imports, so tests and the card share one source.
 * The snapshot keys are also the PATCH request identifiers; the nested field
 * stays dotted and the server maps it to the chatMessage.maxMemories leaf.
 */
export type MemoryControlKey =
  | "maxMemories"
  | "chatMessage.maxMemories"
  | "autoCaptureMaxContextBytes"
  | "userProfileMaxContextBytes"
  | "retrievalMaxTokens";

export type MemoryControl = {
  key: MemoryControlKey;
  /** DOM id fragment for this row's input and its associated help text. */
  id: string;
  default: number;
  /** Unit column text; a Settings translation message. */
  unit: string;
  /** Affects column text; a Settings translation message. */
  affects: string;
  min: number;
  max: number;
  /** Accepted values, shown as help text and as the validation message. */
  accepted: string;
};

const POSITIVE_WHOLE = "Enter a positive whole number.";

export const MEMORY_CONTROLS: readonly MemoryControl[] = [
  {
    key: "maxMemories",
    id: "memory-maxMemories",
    default: 10,
    unit: "Results",
    affects:
      "Maximum memory search results. Manual searches can request fewer; prompt retrieval uses this ceiling.",
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    accepted: POSITIVE_WHOLE,
  },
  {
    key: "chatMessage.maxMemories",
    id: "memory-chatMessage-maxMemories",
    default: 3,
    unit: "Memories",
    affects:
      "Recent memories added at session start in OpenCode V1 and Claude Code. Pi and OpenCode V2 use prompt-based search instead.",
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    accepted: POSITIVE_WHOLE,
  },
  {
    key: "autoCaptureMaxContextBytes",
    id: "memory-autoCaptureMaxContextBytes",
    default: 131072,
    unit: "Bytes",
    affects:
      "Conversation input sent to the memory-summary model through the shared capture pipeline. Smaller values can omit conversation text.",
    min: 16384,
    max: 16777216,
    accepted: "Enter a whole number from 16,384 to 16,777,216.",
  },
  {
    key: "userProfileMaxContextBytes",
    id: "memory-userProfileMaxContextBytes",
    default: 32768,
    unit: "Bytes",
    affects:
      "OpenCode profile-learning input. Smaller values can omit prompts from that input. This control does not limit the other hosts' profile input.",
    min: 1024,
    max: 16777216,
    accepted: "Enter a whole number from 1,024 to 16,777,216.",
  },
  {
    key: "retrievalMaxTokens",
    id: "memory-retrievalMaxTokens",
    default: 2000,
    unit: "Approximate tokens",
    affects:
      "Automatic memory context, including profile text and formatting, added to agent requests across all hosts. Smaller values can show fewer or shorter memories.",
    min: 256,
    max: 65536,
    accepted: "Enter a whole number from 256 to 65,536.",
  },
];

/** Every English message the card shows or exposes to assistive tech. */
export const MEMORY_SETTINGS_MESSAGES: readonly string[] = [
  "Memory",
  "Setting",
  "Value",
  "Default",
  "Unit",
  "Affects",
  "Results",
  "Memories",
  "Bytes",
  "Approximate tokens",
  ...MEMORY_CONTROLS.flatMap((control) => [control.unit, control.affects, control.accepted]),
  "Byte limits count UTF-8 bytes.",
  "Approximate tokens are estimated as ceil(UTF-8 bytes / 4). A provider can count more or fewer tokens for the same text.",
  "These controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output.",
  "Edit ~/.config/omms/omms.jsonc directly to set these limits without the web UI.",
  "Save memory limits",
  "Saved. New memory operations use these limits.",
  "Invalid setting",
  "Config changed. Reload settings and save again.",
  "The memory settings could not be loaded. Reload the page to try again.",
  "The memory settings could not be saved.",
  "Effective value",
  "project",
  "The project value stays in force. Saving edits the global file only.",
];

/** Parse a raw draft string into a valid value, or undefined when invalid. */
export function parseMemoryValue(control: MemoryControl, raw: string): number | undefined {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value)) return undefined;
  return value >= control.min && value <= control.max ? value : undefined;
}

/** The readable Default column; inputs and files keep plain integers. */
export function formatMemoryDefault(value: number): string {
  return value.toLocaleString("en-US");
}

/** The text an input shows: the user's draft when present, else the loaded value. */
export function memoryInputValue(
  control: MemoryControl,
  draft: Record<string, string>,
  loaded: Record<string, number | undefined>
): string {
  const edited = draft[control.key];
  if (typeof edited === "string") return edited;
  return String(loaded[control.key] ?? control.default);
}

/**
 * Save needs a valid draft that differs from the loaded global values. Any
 * invalid edited field blocks the save, so one bad row cannot slip through.
 */
export function canSaveMemory(
  draft: Record<string, string>,
  loaded: Record<string, number | undefined>
): boolean {
  let changed = false;
  for (const control of MEMORY_CONTROLS) {
    const raw = draft[control.key];
    if (typeof raw !== "string") continue;
    const value = parseMemoryValue(control, raw);
    if (value === undefined) return false;
    if (value !== (loaded[control.key] ?? control.default)) changed = true;
  }
  return changed;
}

/** Only the valid, changed fields, keyed by their request identifiers. */
export function memorySaveEdits(
  draft: Record<string, string>,
  loaded: Record<string, number | undefined>
): Partial<Record<MemoryControlKey, number>> {
  const edits: Partial<Record<MemoryControlKey, number>> = {};
  if (!canSaveMemory(draft, loaded)) return edits;
  for (const control of MEMORY_CONTROLS) {
    const raw = draft[control.key];
    if (typeof raw !== "string") continue;
    const value = parseMemoryValue(control, raw)!;
    if (value !== (loaded[control.key] ?? control.default)) edits[control.key] = value;
  }
  return edits;
}

/** Why a Memory save failed, mapped from the server's error text. */
export type MemorySaveFailure =
  { kind: "stale" } | { kind: "invalid"; key: MemoryControlKey } | { kind: "unknown" };

/** The server's exact stale-config message, recognised without carrying raw text. */
export const STALE_CONFIG_MESSAGE = "Config changed. Reload settings and save again.";

/**
 * Classify a failed save from the server's error text. Only the recognised
 * stale message and the five limit identifiers map to specific identities;
 * everything else, including network text, becomes one generic failure so no
 * arbitrary English error prose reaches the page.
 */
export function classifyMemorySaveFailure(errorText: string): MemorySaveFailure {
  if (errorText === STALE_CONFIG_MESSAGE) return { kind: "stale" };
  const ids = MEMORY_CONTROLS.map((control) => control.key.replace(/\./g, "\\.")).join("|");
  const match = new RegExp(`^Invalid (${ids}) setting\\b`).exec(errorText);
  if (match) return { kind: "invalid", key: match[1] as MemoryControlKey };
  return { kind: "unknown" };
}
