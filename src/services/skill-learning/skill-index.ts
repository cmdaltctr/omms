import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { realPathOrSelf } from "./skill-folders.js";

/** How many folder levels below a watched folder are searched for `SKILL.md`. */
export const SKILL_INDEX_MAX_DEPTH = 4;
export const SKILL_INDEX_CACHE_MS = 60_000;

const SKIP_FOLDERS = new Set([".git", "node_modules"]);

export interface SkillIndexEntry {
  /** The front matter `name`, or the folder name when the front matter has none. */
  name: string;
  /** Full path of the `SKILL.md` file. */
  path: string;
  /** The watched folder the skill was found in. */
  folder: string;
  description: string;
}

export interface SkillIndex {
  folders: string[];
  /** Every skill found. Two skills can share a name; both are kept. */
  entries: SkillIndexEntry[];
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    (trimmed[0] === '"' || trimmed[0] === "'") &&
    trimmed[trimmed.length - 1] === trimmed[0]
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Reads top-level `key: value` pairs from YAML front matter. Folded values join their lines. */
export function readFrontMatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const fields: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!field) continue;
    let value = field[2]!.trim();
    if (value === "" || /^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
      value = block.join(" ");
    }
    fields[field[1]!] = unquote(value);
  }
  return fields;
}

function isDirectory(path: string): boolean {
  try {
    // statSync follows links, so linked skill folders are searched too.
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readEntry(path: string, folder: string): SkillIndexEntry {
  let fields: Record<string, string> = {};
  try {
    fields = readFrontMatter(readFileSync(path, "utf8"));
  } catch {
    // An unreadable file still names a skill by its folder.
  }
  return {
    name: fields.name || basename(dirname(path)),
    path,
    folder,
    description: fields.description ?? "",
  };
}

function walk(dir: string, depth: number, folder: string, out: SkillIndexEntry[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  if (names.includes("SKILL.md")) out.push(readEntry(join(dir, "SKILL.md"), folder));
  if (depth >= SKILL_INDEX_MAX_DEPTH) return;
  for (const name of names.sort()) {
    if (SKIP_FOLDERS.has(name)) continue;
    const child = join(dir, name);
    if (isDirectory(child)) walk(child, depth + 1, folder, out);
  }
}

/**
 * Lists every `SKILL.md` up to four folder levels below each watched folder.
 * A file reached twice through a link is listed once, under its first path. No cache.
 */
export function buildSkillIndex(folders: readonly string[]): SkillIndex {
  const found: SkillIndexEntry[] = [];
  for (const folder of folders) {
    if (isDirectory(folder)) walk(folder, 0, folder, found);
  }
  const seen = new Set<string>();
  const entries = found.filter((entry) => {
    const real = realPathOrSelf(entry.path);
    if (seen.has(real)) return false;
    seen.add(real);
    return true;
  });
  return { folders: [...folders], entries };
}

const cache = new Map<string, { builtAt: number; index: SkillIndex }>();

/** The index for these folders, rebuilt when it is older than 60 seconds or the list changes. */
export function getSkillIndex(folders: readonly string[], now = Date.now()): SkillIndex {
  const key = JSON.stringify(folders);
  const hit = cache.get(key);
  if (hit && now - hit.builtAt < SKILL_INDEX_CACHE_MS) return hit.index;
  const index = buildSkillIndex(folders);
  cache.clear();
  cache.set(key, { builtAt: now, index });
  return index;
}

/** Drops the cached index, for example after OMMS writes a skill file. */
export function clearSkillIndexCache(): void {
  cache.clear();
}
