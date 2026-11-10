import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../../services/logger.js";

const SKILL_NAMES = ["omms-memory", "omms-remember"];

/**
 * The package's `skills` folder: the nearest parent folder whose
 * `package.json` names om-memory-system. Walking up also works when a host
 * bundles the plugin into one file at another depth.
 */
export function packageSkillsFolder(moduleUrl: string = import.meta.url): string {
  let folder = dirname(fileURLToPath(moduleUrl));
  for (let depth = 0; depth < 8; depth++) {
    try {
      const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === "om-memory-system") return join(folder, "skills");
    } catch {
      // No readable package.json here; keep walking up.
    }
    const parent = dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  return join(dirname(fileURLToPath(moduleUrl)), "..", "..", "..", "skills");
}

const defaultFolder = packageSkillsFolder();

type SkillsConfig = { skills?: { paths?: string[]; urls?: string[] } };

/**
 * V1: add the package's skills folder to OpenCode's skill paths once. The V1
 * SDK `Config` type has no `skills` key, although OpenCode reads it.
 */
export function applySkillsPathConfig(config: object, folder: string = defaultFolder): void {
  const cfg = config as SkillsConfig;
  if (!existsSync(folder)) {
    log("OMMS skills folder not found; the packaged skills are not loaded", { folder });
    return;
  }
  const paths = cfg.skills?.paths ?? [];
  if (paths.includes(folder)) return;
  cfg.skills = { ...cfg.skills, paths: [...paths, folder] };
}

/** V2: add the package's skills to the plugin's skill list once. */
export function addPackageSkill(
  editor: { get(id: string): unknown; add(skill: any): void },
  folder: string = defaultFolder
): void {
  for (const name of SKILL_NAMES) {
    if (editor.get(name)) continue;
    const path = join(folder, name, "SKILL.md");
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      log("OMMS skill file not found; the skill is not loaded", { path });
      continue;
    }
    const description = content.match(/^description: (.+)$/m)?.[1]?.trim();
    editor.add({ id: name, name, description, path, content });
  }
}
