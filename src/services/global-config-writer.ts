import { createHash, randomUUID } from "node:crypto";
import { promises as fs, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import {
  CONFIG_TEMPLATE,
  getGlobalConfigSourcePath,
  getGlobalConfigWritePath,
  validateGlobalConfig,
} from "../config.js";

const keys = new Set([
  "opencodeProvider",
  "opencodeModel",
  "piProvider",
  "piModel",
  "captureTrace",
  "captureTraceRetentionDays",
  "captureAttemptRetentionDays",
  "autoBackfill",
  "opencodeBackfillModel",
  "piBackfillModel",
  "webServerAutoStart",
]);

export class ConfigConflictError extends Error {
  readonly status = 409;
  constructor() {
    super("Config changed. Reload settings and save again.");
  }
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function snapshot(path: string): Promise<{ content: string; revision: string }> {
  const content = await fs.readFile(path, "utf8");
  const stat = await fs.stat(path);
  return { content, revision: `${stat.mtimeMs}:${stat.size}:${digest(content)}` };
}
export function readGlobalConfigRevision(): string {
  const source = getGlobalConfigSourcePath();
  if (!source) return digest(CONFIG_TEMPLATE);
  // Synchronous read keeps the revision tied to the file shown by GET /settings.
  const content = readFileSync(source, "utf8");
  const stat = statSync(source);
  return `${stat.mtimeMs}:${stat.size}:${digest(content)}`;
}

let queue: Promise<void> = Promise.resolve();
let pending = 0;
let lastBaseRevision: string | undefined;
let lastWrittenRevision: string | undefined;

/** Write only page-editable keys; reject edits based on a stale config revision. */
export async function writeGlobalConfigKeys(
  edits: Record<string, unknown>,
  expectedRevision: string
): Promise<{ revision: string; migratedLegacy: boolean }> {
  if (!edits || !Object.keys(edits).length) throw new Error("No settings to save");
  for (const [key, value] of Object.entries(edits)) {
    if (!keys.has(key)) throw new Error(`Setting ${key} cannot be edited here`);
    if (
      key === "captureTrace" || key === "autoBackfill" || key === "webServerAutoStart"
        ? typeof value !== "boolean"
        : key.endsWith("RetentionDays")
          ? !Number.isSafeInteger(value) || (value as number) < 1
          : typeof value !== "string" || !value.trim()
    ) {
      throw new Error(`Invalid ${key} setting`);
    }
  }
  const wasQueued = pending > 0;
  pending++;
  const save = queue.then(async () => {
    const source = getGlobalConfigSourcePath();
    const target = getGlobalConfigWritePath();
    const original = source
      ? await snapshot(source)
      : { content: CONFIG_TEMPLATE, revision: digest(CONFIG_TEMPLATE) };
    if (
      original.revision !== expectedRevision &&
      !(
        wasQueued &&
        lastBaseRevision === expectedRevision &&
        lastWrittenRevision === original.revision
      )
    ) {
      throw new ConfigConflictError();
    }
    let content = original.content;
    for (const [key, value] of Object.entries(edits)) {
      content = applyEdits(
        content,
        modify(content, [key], value, {
          formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
        })
      );
    }
    const errors: ParseError[] = [];
    const parsed: unknown = parse(content, errors, { allowTrailingComma: true });
    if (errors.length) throw new Error("Config contains invalid JSONC");
    validateGlobalConfig(parsed);
    if (source && (await snapshot(source)).revision !== original.revision) {
      throw new ConfigConflictError();
    }
    await fs.mkdir(dirname(target), { recursive: true });
    const temp = join(dirname(target), `.omms-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, content, { mode: source ? (await fs.stat(source)).mode : 0o600 });
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
    const revision = (await snapshot(target)).revision;
    lastBaseRevision = expectedRevision;
    lastWrittenRevision = revision;
    return { revision, migratedLegacy: Boolean(source && source !== target) };
  });
  queue = save.then(
    () => {},
    () => {}
  );
  try {
    return await save;
  } finally {
    pending--;
  }
}
