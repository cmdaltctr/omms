import { lstat, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getTraceDirectory } from "./capture-diagnostics.js";

const traceName = /^capture-(\d{4}-\d{2}-\d{2})\.jsonl$/;

function tracePath(file: string): string {
  if (!traceName.test(file)) throw new Error("Invalid trace file name");
  return join(getTraceDirectory(), file);
}

export async function listSettingsTraces() {
  let files: string[];
  try {
    files = await readdir(getTraceDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const traces = await Promise.all(
    files
      .filter((file) => traceName.test(file))
      .map(async (file) => {
        const stats = await lstat(tracePath(file));
        return stats.isFile() ? { file, date: traceName.exec(file)![1], size: stats.size } : null;
      })
  );
  return traces.filter((trace) => trace !== null).sort((a, b) => b.file.localeCompare(a.file));
}
export async function readSettingsTrace(file: string): Promise<string> {
  const path = tracePath(file);
  if (!(await lstat(path)).isFile()) throw new Error("Invalid trace file");
  return readFile(path, "utf8");
}

export async function deleteSettingsTrace(file: string): Promise<void> {
  const path = tracePath(file);
  if (!(await lstat(path)).isFile()) throw new Error("Invalid trace file");
  await unlink(path);
}
