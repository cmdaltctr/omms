import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { walkTree } from "../legacy-migration.js";

/** The total size in bytes of the files in a folder. A missing folder counts as zero. */
export function folderSize(folder: string): number {
  if (!existsSync(folder)) return 0;
  return walkTree(folder).files.reduce((total, rel) => total + statSync(join(folder, rel)).size, 0);
}
