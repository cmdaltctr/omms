import { join } from "node:path";
import { homedir } from "node:os";

/** Global config and data locations. Kept apart from config assembly. */
export const OMMS_CONFIG_DIR = join(homedir(), ".config", "omms");
export const DATA_DIR = join(homedir(), ".omms");
export const LEGACY_CONFIG_FILES = [
  join(homedir(), ".config", "opencode", "opencode-mem.jsonc"),
  join(homedir(), ".config", "opencode", "opencode-mem.json"),
];
// Dual-read: the omms config wins; a legacy config is read only without an omms file.
export const CONFIG_FILES = [
  join(OMMS_CONFIG_DIR, "omms.jsonc"),
  join(OMMS_CONFIG_DIR, "omms.json"),
  ...LEGACY_CONFIG_FILES,
];
