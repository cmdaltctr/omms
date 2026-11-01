import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  deleteSkillVersion,
  getLatestVersion,
  getProposal,
  saveSkillVersion,
  updateProposalState,
  type SkillAppliedBy,
  type SkillProposal,
  type SkillVersion,
} from "./proposal-store.js";
import { clearSkillIndexCache } from "./skill-index.js";
import type { SkillStore } from "./store.js";

/** The only file name OMMS writes in a skill folder. */
export const SKILL_FILE_NAME = "SKILL.md";
const NEW_SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEMP_SUFFIX = ".omms-tmp";

export interface ApplyDeps {
  /** An initialised store. */
  store: SkillStore;
  /** The watched skill folders. */
  folders: readonly string[];
  now?: () => number;
}

export type ApplyFailureCode =
  | "not-found"
  | "not-pending"
  | "not-skill-file"
  | "outside-folder"
  | "invalid-name"
  | "stale"
  | "exists"
  | "read-only"
  | "write-failed"
  | "state-write-failed";

export type ApplyResult =
  | { ok: true; code: "applied"; proposal: SkillProposal; path: string; writtenHash: string }
  | { ok: false; code: ApplyFailureCode; message: string };

export type UndoFailureCode =
  | "not-found"
  | "not-applied"
  | "no-version"
  | "outside-folder"
  | "changed"
  | "read-only"
  | "write-failed"
  | "state-write-failed";

export type UndoResult =
  | { ok: true; code: "undone"; proposal: SkillProposal; path: string }
  | {
      ok: false;
      code: UndoFailureCode;
      message: string;
      /** For `changed`: the content undo would have restored, null for a new skill. */
      savedContent?: string | null;
    };

/** sha256 of a skill file's content, as stored in `base_hash` and `written_hash`. */
export function hashSkillContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function readHash(path: string): string | null {
  try {
    return hashSkillContent(readFileSync(path));
  } catch {
    return null;
  }
}

function realFolders(folders: readonly string[]): string[] {
  const real: string[] = [];
  for (const folder of folders) {
    try {
      real.push(realpathSync(folder));
    } catch {
      // A missing folder holds nothing to write to.
    }
  }
  return real;
}

/**
 * The real path of `path` after following links. A part that does not exist
 * yet (a new skill's folder or file) is joined onto the real path of the
 * nearest part that does.
 */
function realTarget(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.push(basename(current));
      current = parent;
    }
  }
}

function isInside(path: string, folder: string): boolean {
  return path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
}

type Target =
  | { ok: true; real: string; folders: string[] }
  | { ok: false; code: "not-skill-file" | "outside-folder"; message: string };

/** The real file to write, only when it is a `SKILL.md` inside a watched folder. */
function checkTarget(path: string | null, folders: readonly string[]): Target {
  if (!path || basename(path) !== SKILL_FILE_NAME) {
    return {
      ok: false,
      code: "not-skill-file",
      message: `Only ${SKILL_FILE_NAME} files can be written`,
    };
  }
  const real = realTarget(path);
  const roots = realFolders(folders);
  if (basename(real) !== SKILL_FILE_NAME) {
    return {
      ok: false,
      code: "not-skill-file",
      message: `${path} links to a file that is not ${SKILL_FILE_NAME}`,
    };
  }
  if (!roots.some((root) => isInside(real, root))) {
    return { ok: false, code: "outside-folder", message: `${path} is not inside a watched folder` };
  }
  return { ok: true, real, folders: roots };
}

/**
 * Writes a temp file beside the target, then moves it into place in one step.
 * With `overwrite` false, a hard link puts it in place and fails when a file
 * appeared there since the check, so a new skill never replaces one.
 */
function replaceFile(path: string, content: string, overwrite = true): void {
  const temp = path + TEMP_SUFFIX;
  try {
    writeFileSync(temp, content);
    if (overwrite) {
      renameSync(temp, path);
    } else {
      linkSync(temp, path);
      rmSync(temp, { force: true });
    }
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The fixed answer when the state write fails; it holds no path and no error text. */
const STATE_WRITE_FAILED =
  "The proposal state could not be saved, so the SKILL.md change was rolled back";

/**
 * Writes a pending proposal to its `SKILL.md` (design §7). Checks the real
 * path, the file name, a new skill's name and the base hash first. Saves the
 * previous content before the write. Expected outcomes return a result code.
 */
export async function applyProposal(
  id: string,
  by: SkillAppliedBy,
  deps: ApplyDeps
): Promise<ApplyResult> {
  const now = deps.now ?? Date.now;
  const { store } = deps;
  if (store.isReadOnly()) {
    return {
      ok: false,
      code: "read-only",
      message: "skills.db is from a newer OMMS and is read-only",
    };
  }
  const proposal = await getProposal(store, id);
  if (!proposal) return { ok: false, code: "not-found", message: `No proposal ${id}` };
  if (proposal.state !== "pending") {
    return { ok: false, code: "not-pending", message: `Proposal ${id} is ${proposal.state}` };
  }
  if (proposal.kind === "new" && !NEW_SKILL_NAME.test(proposal.skillName)) {
    return {
      ok: false,
      code: "invalid-name",
      message: "A new skill name may hold only lower-case letters, digits and single hyphens",
    };
  }
  const target = checkTarget(proposal.skillPath, deps.folders);
  if (!target.ok) return target;
  const { real } = target;

  let previous: string | null = null;
  if (proposal.kind === "new") {
    if (existsSync(real)) {
      return { ok: false, code: "exists", message: `${proposal.skillPath} already exists` };
    }
  } else {
    // A missing file or a changed file both mean the draft no longer fits.
    const current = readHash(real);
    if (current === null || current !== proposal.baseHash) {
      await updateProposalState(store, id, "stale", now());
      return { ok: false, code: "stale", message: "Stale: the file changed since this draft" };
    }
    previous = readFileSync(real, "utf8");
  }

  const writtenHash = hashSkillContent(proposal.content);
  const versionId = await saveSkillVersion(
    store,
    { proposalId: id, path: real, previousContent: previous, writtenHash },
    now()
  );
  try {
    if (proposal.kind === "new") mkdirSync(dirname(real), { recursive: true });
    replaceFile(real, proposal.content, proposal.kind !== "new");
  } catch (error) {
    await deleteSkillVersion(store, versionId);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { ok: false, code: "exists", message: `${proposal.skillPath} already exists` };
    }
    return { ok: false, code: "write-failed", message: errorText(error) };
  }
  clearSkillIndexCache();
  const appliedAt = now();
  try {
    await updateProposalState(store, id, "applied", appliedAt, by);
  } catch {
    // The file and the state must agree: put the file back and drop the version row.
    try {
      if (proposal.kind === "new") {
        unlinkSync(real);
        removeEmptyFolder(dirname(real), target.folders);
      } else if (previous !== null) {
        replaceFile(real, previous);
      }
    } catch {
      // Best effort; the code below still tells the reader the apply did not finish.
    }
    await deleteSkillVersion(store, versionId).catch(() => {});
    clearSkillIndexCache();
    return { ok: false, code: "state-write-failed", message: STATE_WRITE_FAILED };
  }
  return {
    ok: true,
    code: "applied",
    proposal: { ...proposal, state: "applied", appliedBy: by, updatedAt: appliedAt },
    path: real,
    writtenHash,
  };
}

/** Removes a new skill's folder when undo left it empty. Never a watched folder itself. */
function removeEmptyFolder(folder: string, roots: readonly string[]): void {
  if (roots.includes(folder)) return;
  try {
    if (readdirSync(folder).length === 0) rmdirSync(folder);
  } catch {
    // The folder is gone or not empty; leave it.
  }
}

type UndoFailure = Extract<UndoResult, { ok: false }>;
type UndoPlan =
  | {
      ok: true;
      proposal: SkillProposal;
      version: SkillVersion;
      real: string;
      folders: string[];
    }
  | UndoFailure;

const READ_ONLY_MESSAGE = "skills.db is from a newer OMMS and is read-only";

/** What `checkUndo` needs. A list can read these for many proposals in one query. */
export interface UndoFacts {
  id: string;
  readOnly: boolean;
  /** The proposal's state. */
  state: string;
  /** The newest saved version of the proposal, or null when it has none. */
  version: { path: string; writtenHash: string } | null;
  folders: readonly string[];
}

type UndoCheck =
  | { ok: true; real: string; folders: string[] }
  | {
      ok: false;
      code: "read-only" | "not-applied" | "no-version" | "outside-folder" | "changed";
      message: string;
    };

/**
 * Every undo check that needs no database read: the store is writable, the
 * proposal is applied, a version exists, its file is a `SKILL.md` inside a
 * watched folder, and the file still holds what OMMS wrote. Reads one file.
 * `planUndo` and the `canUndo` of a list both run it, so they cannot disagree.
 */
export function checkUndo(facts: UndoFacts): UndoCheck {
  const { id, state, version } = facts;
  if (facts.readOnly) return { ok: false, code: "read-only", message: READ_ONLY_MESSAGE };
  if (state !== "applied") {
    return { ok: false, code: "not-applied", message: `Proposal ${id} is ${state}` };
  }
  if (!version) return { ok: false, code: "no-version", message: `No saved version for ${id}` };
  const target = checkTarget(version.path, facts.folders);
  if (!target.ok) return { ok: false, code: "outside-folder", message: target.message };
  if (readHash(target.real) !== version.writtenHash) {
    return {
      ok: false,
      code: "changed",
      message: "The file changed since OMMS wrote it, so undo would lose that change",
    };
  }
  return { ok: true, real: target.real, folders: target.folders };
}

/** Every check undo makes before it writes. Reads only; changes nothing. */
async function planUndo(id: string, deps: ApplyDeps): Promise<UndoPlan> {
  const { store } = deps;
  // A read-only store refuses before it looks the proposal up.
  if (store.isReadOnly()) return { ok: false, code: "read-only", message: READ_ONLY_MESSAGE };
  const proposal = await getProposal(store, id);
  if (!proposal) return { ok: false, code: "not-found", message: `No proposal ${id}` };
  const version = await getLatestVersion(store, id);
  const check = checkUndo({
    id,
    readOnly: false,
    state: proposal.state,
    version,
    folders: deps.folders,
  });
  if (!check.ok) {
    return check.code === "changed"
      ? { ...check, savedContent: version?.previousContent ?? null }
      : check;
  }
  return { ok: true, proposal, version: version!, real: check.real, folders: check.folders };
}

/**
 * Restores the content saved before the last apply, or deletes the file the
 * apply created. Only when the file still matches what OMMS wrote; otherwise
 * refuses and returns the saved content. So an older change is refused once a
 * later change has rewritten the file, until that later change is undone.
 */
export async function undoProposal(id: string, deps: ApplyDeps): Promise<UndoResult> {
  const now = deps.now ?? Date.now;
  const plan = await planUndo(id, deps);
  if (!plan.ok) return plan;
  const { proposal, version, real, folders } = plan;
  // The plan checked that the file still holds what OMMS wrote; keep it to put back.
  const written = readFileSync(real, "utf8");
  try {
    if (version.previousContent === null) {
      unlinkSync(real);
      removeEmptyFolder(dirname(real), folders);
    } else {
      replaceFile(real, version.previousContent);
    }
  } catch (error) {
    return { ok: false, code: "write-failed", message: errorText(error) };
  }
  clearSkillIndexCache();
  const undoneAt = now();
  try {
    await updateProposalState(deps.store, id, "undone", undoneAt);
  } catch {
    // The proposal stays applied, so the file goes back to what it was written as.
    try {
      mkdirSync(dirname(real), { recursive: true });
      replaceFile(real, written);
    } catch {
      // Best effort; the code below still tells the reader the undo did not finish.
    }
    clearSkillIndexCache();
    return { ok: false, code: "state-write-failed", message: STATE_WRITE_FAILED };
  }
  return {
    ok: true,
    code: "undone",
    proposal: { ...proposal, state: "undone", updatedAt: undoneAt },
    path: real,
  };
}
