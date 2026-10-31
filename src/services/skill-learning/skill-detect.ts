import { homedir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { realPathOrSelf } from "./skill-folders.js";
import type { SkillIndex, SkillIndexEntry } from "./skill-index.js";
import type { SkillUseRow } from "./store.js";

/** The parts of a work unit that skill detection reads. */
export interface SkillDetectInput {
  prompt: string;
  toolCalls: ReadonlyArray<DetectToolCall>;
}

/** `path` is the full read path the host readers keep; `input` can be cut. */
interface DetectToolCall {
  name: string;
  input: string;
  path?: string;
}

const READ_TOOLS = new Set(["read", "view"]);
const READ_PATH_KEYS = ["file_path", "filePath", "path"];

/**
 * Reads one string field from a tool input as the host readers format it:
 * `key: "value", key2: ...` (Claude Code, Pi, OpenCode live) or JSON
 * (OpenCode import). Inputs can be cut at 100 characters, so this does not
 * parse the whole string.
 */
export function toolInputField(input: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|[,{]\\s*)"?${escaped}"?\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`);
  const match = pattern.exec(input);
  if (!match) return null;
  try {
    const value: unknown = JSON.parse(match[1]!);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function byName(index: SkillIndex, name: string): SkillIndexEntry[] {
  return index.entries.filter((entry) => entry.name === name);
}

/**
 * A `plugin:skill` name matches a watched skill on the part after the colon.
 * Otherwise it keeps its full form, so a command such as `opsx:apply` is not shown as `apply`.
 */
function skillName(name: string, index: SkillIndex): string {
  const trimmed = name.trim();
  const bare = trimmed.slice(trimmed.lastIndexOf(":") + 1);
  return byName(index, bare).length > 0 ? bare : trimmed;
}

/** A path only when the name points at exactly one skill. */
function pathFor(index: SkillIndex, name: string): string | null {
  const found = byName(index, name);
  return found.length === 1 ? found[0]!.path : null;
}

function skillToolName(call: { name: string; input: string }): string | null {
  if (call.name === "Skill") return toolInputField(call.input, "skill");
  if (call.name === "skill") return toolInputField(call.input, "name");
  return null;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

function insideFolder(path: string, folder: string): boolean {
  const root = resolve(expandHome(folder));
  return path.startsWith(root.endsWith(sep) ? root : root + sep);
}

function readSkillUse(
  call: DetectToolCall,
  index: SkillIndex
): Omit<SkillUseRow, "position"> | null {
  if (!READ_TOOLS.has(call.name.toLowerCase())) return null;
  // Prefer the full path; the input text is cut at 100 characters.
  const candidates =
    call.path !== undefined
      ? [call.path]
      : READ_PATH_KEYS.map((key) => toolInputField(call.input, key));
  for (const raw of candidates) {
    if (!raw || !/[\\/]SKILL\.md$/.test(raw)) continue;
    const path = resolve(expandHome(raw));
    // A read through a linked folder matches the indexed file by its real path.
    const real = realPathOrSelf(path);
    const entry =
      index.entries.find((e) => resolve(expandHome(e.path)) === path) ??
      index.entries.find((e) => realPathOrSelf(e.path) === real);
    if (entry) return { name: entry.name, path: entry.path, method: "read" };
    if (!index.folders.some((folder) => insideFolder(path, folder))) return null;
    return { name: basename(dirname(path)), path, method: "read" };
  }
  return null;
}

/** The skill names a prompt invokes by its slash form. Unknown names are left to the caller. */
function commandNames(prompt: string, index: SkillIndex): string[] {
  const names: string[] = [];
  const lead = /^\/([\w:.-]+)(?:\s|$)/.exec(prompt.trimStart());
  if (lead) names.push(skillName(lead[1]!, index));
  for (const match of prompt.matchAll(/<command-name>\s*\/([\w:.-]+)\s*<\/command-name>/g)) {
    names.push(skillName(match[1]!, index));
  }
  return names;
}

/**
 * Finds the skills a turn used. `tool`: the host's skill tool loaded it.
 * `read`: a read tool opened a `SKILL.md` inside a watched folder.
 * `command`: the prompt invoked a known skill by its slash form.
 * Each skill is listed once per method. `position` is the index of the tool
 * call that loaded the skill (the first one for a repeat), and -1 for `command`.
 */
export function detectSkillUses(unit: SkillDetectInput, index: SkillIndex): SkillUseRow[] {
  const uses: SkillUseRow[] = [];
  const seen = new Set<string>();
  const add = (use: SkillUseRow): void => {
    const key = `${use.method}\u0000${use.name}\u0000${use.path ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    uses.push(use);
  };

  for (const name of commandNames(unit.prompt, index)) {
    if (byName(index, name).length > 0) {
      add({ name, path: pathFor(index, name), method: "command", position: -1 });
    }
  }
  for (const [position, call] of unit.toolCalls.entries()) {
    const toolName = skillToolName(call);
    if (toolName) {
      const name = skillName(toolName, index);
      if (name) add({ name, path: pathFor(index, name), method: "tool", position });
      continue;
    }
    const read = readSkillUse(call, index);
    if (read) add({ ...read, position });
  }
  return uses;
}
