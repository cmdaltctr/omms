import {
  findSpace,
  listSpaces,
  readRegistryFile,
  resolveSpaceFolder,
  spaceLinks,
  SpaceError,
  type SpaceRegistry,
} from "./registry.js";
import {
  archiveStoredSpace,
  createStoredSpace,
  linkStoredSpace,
  switchStoredSpace,
  unarchiveStoredSpace,
  unlinkStoredSpace,
  type SpaceFiles,
} from "./registry-store.js";
import type { SpaceTransferContext } from "./transfer-service.js";
import type { ExportSpaceResult } from "./export-space.js";
import type { ImportSpaceResult } from "./import-space.js";

/**
 * The space operations an agent or a terminal may run: list, status, create, archive,
 * unarchive, use (switch), preview, copy, link and unlink. Delete, rename, backup and
 * restore exist only in the web app, because a person must confirm them, and so does a
 * move; export and import belong to the web app and the CLI, not the `memory` tool. The
 * CLI `space` command, the `memory` tool `space` mode and the Claude Code plugin tool
 * all call this one function, so the hosts stay equal.
 */

export interface SpaceOperationArgs {
  action?: string;
  /** A space name or id: the space acted on, the transfer source, or the link target. */
  name?: string;
  /** The transfer target (preview, copy): a space name or id. */
  to?: string;
  /** Inclusive ISO 8601 lower bound on the creation time (preview, copy, export). */
  since?: string;
  /** Inclusive ISO 8601 upper bound on the creation time (preview, copy, export). */
  until?: string;
  /** Only memories with this project tag, as a preview's groups show it (preview, copy). */
  project?: string;
  /** The space that owns the link (link, unlink); the active space when omitted. */
  owner?: string;
  /** Where the export file is written (export). */
  outPath?: string;
  /** The export file to read (import). */
  filePath?: string;
  /** Opt-in that adds the personal memories and the learned profile (export). */
  includeProfile?: boolean;
  /** Gives every imported project memory this folder's project tag (import). */
  retagToProject?: string;
}

/** Folder roots and embedding settings the space-bound actions need, snapshotted by the caller. */
export type SpaceOperationSettings = Omit<SpaceTransferContext, "files">;

/** The export call the shared operation makes; the caller's bridge adds the CONFIG values. */
export interface SpaceExportRequest {
  folder: string;
  outPath: string;
  since?: number;
  until?: number;
  includeProfile?: boolean;
}

/** The import call the shared operation makes; the caller's bridge adds the CONFIG values. */
export interface SpaceImportRequest {
  filePath: string;
  spaceName: string;
  retagToProject?: string;
}

/**
 * The export and import calls of a caller allowed to run them (the CLI). The `memory`
 * tool passes no bridge, so its `space` mode refuses both actions; the CLI supplies
 * one, so the operations are defined in this module once for every surface.
 */
export interface SpacePortability {
  export: (request: SpaceExportRequest) => Promise<ExportSpaceResult>;
  import: (request: SpaceImportRequest) => Promise<ImportSpaceResult>;
}

export interface SpaceOperationContext {
  files: SpaceFiles;
  /** The space this process uses now, from the last config load. */
  current: { id: string; name: string; customStoragePath: boolean; problem?: string };
  /** Needed by preview, copy and export; the caller snapshots it from CONFIG. */
  settings?: SpaceOperationSettings;
  /** The export and import bridge of a caller allowed to run them. */
  portability?: SpacePortability;
}

/** Actions that need a person at the web app, so the CLI and the `memory` tool refuse them. */
export const WEB_ONLY_SPACE_ACTIONS = ["delete", "rename", "backup", "restore"];
export const SPACE_ACTIONS = [
  "list",
  "status",
  "create",
  "archive",
  "unarchive",
  "use",
  "preview",
  "copy",
  "link",
  "unlink",
];
const WEB_ONLY = WEB_ONLY_SPACE_ACTIONS;
const ACTIONS = SPACE_ACTIONS;
const MOVE_REFUSAL = "Only the web app can move memories between spaces.";

function summary(registry: SpaceRegistry) {
  return listSpaces(registry).map((space) => ({
    id: space.id,
    name: space.name,
    active: space.id === registry.activeSpaceId,
    archived: space.archived,
    createdAt: space.createdAt || undefined,
  }));
}

function activeOf(registry: SpaceRegistry) {
  const active = listSpaces(registry).find((space) => space.id === registry.activeSpaceId)!;
  return { id: active.id, name: active.name };
}

/** An ISO 8601 date or date-time as epoch milliseconds, or the reason it is not one. */
function epochMsOf(value: string, label: string): number | string {
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? `The ${label} date "${value}" is not a valid ISO 8601 date.` : ms;
}

/** Runs a preview or a copy through the transfer service (design D3). A move never reaches here. */
async function runTransfer(
  action: "preview" | "copy",
  args: SpaceOperationArgs,
  context: SpaceOperationContext,
  from: string,
  to: string
): Promise<Record<string, unknown>> {
  if (!context.settings) {
    return {
      success: false,
      error: `The ${action} action needs the space settings; the caller did not supply them.`,
    };
  }
  const since = args.since === undefined ? 0 : epochMsOf(args.since, "since");
  if (typeof since === "string") return { success: false, error: since };
  const until = args.until === undefined ? Number.MAX_SAFE_INTEGER : epochMsOf(args.until, "until");
  if (typeof until === "string") return { success: false, error: until };
  const project = args.project?.trim();
  const filter = { since, until, ...(project ? { projectTag: project } : {}) };
  const { previewSpaceTransfer, applySpaceTransfer } = await import("./transfer-service.js");
  const transfer = { files: context.files, ...context.settings };
  if (action === "preview") {
    const outcome = await previewSpaceTransfer({ from, to, filter }, transfer);
    if (!outcome.ok) return { success: false, error: outcome.error };
    return { success: true, preview: outcome.preview };
  }
  const outcome = await applySpaceTransfer({ from, to, filter, mode: "copy" }, transfer);
  if (!outcome.ok) return { success: false, error: outcome.error };
  const result = outcome.result;
  if (!result.ok) {
    return {
      success: false,
      error: `The copy stopped at the ${result.error?.step ?? "write"} step: ${
        result.error?.message ?? "unknown failure"
      }`,
      copied: result.copied,
      skipped: result.skipped,
    };
  }
  return {
    success: true,
    copied: result.copied,
    skipped: result.skipped,
    embeddedAgain: result.embeddedAgain,
    message: `Copied ${result.copied} memories (${result.skipped} exact duplicates skipped).`,
  };
}

/** Links or unlinks two stored spaces (design D5). The Default space owns no links. */
async function runLink(
  action: "link" | "unlink",
  args: SpaceOperationArgs,
  context: SpaceOperationContext,
  target: string
): Promise<Record<string, unknown>> {
  const owner = args.owner?.trim() || context.current.name;
  const change = action === "link" ? linkStoredSpace : unlinkStoredSpace;
  const registry = await change(context.files, owner, target);
  const ownerName = findSpace(registry, owner)?.name ?? owner;
  const targetName = findSpace(registry, target)?.name ?? target;
  return {
    success: true,
    message:
      action === "link"
        ? `Space "${ownerName}" now links "${targetName}".`
        : `Space "${ownerName}" no longer links "${targetName}".`,
    links: spaceLinks(registry, ownerName),
  };
}

/** Export and import: refused without a bridge (the `memory` tool), run through the CLI's one. */
async function runPortabilityAction(
  action: "export" | "import",
  args: SpaceOperationArgs,
  context: SpaceOperationContext
): Promise<Record<string, unknown>> {
  const portability = context.portability;
  if (!portability) {
    return {
      success: false,
      error: `The memory tool cannot ${action} a space. Use the web app or the CLI.`,
    };
  }
  if (action === "export") {
    const name = args.name?.trim();
    if (!name) return { success: false, error: "The export action needs a space name." };
    const outPath = args.outPath?.trim();
    if (!outPath) return { success: false, error: "The export action needs an output path." };
    if (!context.settings) {
      return {
        success: false,
        error: "The export action needs the space settings; the caller did not supply them.",
      };
    }
    const since = args.since === undefined ? undefined : epochMsOf(args.since, "since");
    if (typeof since === "string") return { success: false, error: since };
    const until = args.until === undefined ? undefined : epochMsOf(args.until, "until");
    if (typeof until === "string") return { success: false, error: until };
    const read = readRegistryFile(context.files.registryPath);
    const space = findSpace(read.registry, name);
    if (!space) return { success: false, error: `No space named "${name}".` };
    const result = await portability.export({
      folder: resolveSpaceFolder(space.id, context.settings.paths),
      outPath,
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
      ...(args.includeProfile ? { includeProfile: true } : {}),
    });
    return { success: true, export: result };
  }
  const filePath = args.filePath?.trim();
  if (!filePath) return { success: false, error: "The import action needs an export file." };
  const spaceName = args.name?.trim();
  if (!spaceName) {
    return { success: false, error: "The import action needs a name for the new space." };
  }
  const retagToProject = args.retagToProject?.trim();
  const result = await portability.import({
    filePath,
    spaceName,
    ...(retagToProject ? { retagToProject } : {}),
  });
  if (!result.ok) {
    return { success: false, error: result.reason, warnings: result.warnings };
  }
  const memories = result.counts.projectMemories + result.counts.userMemories;
  return {
    success: true,
    message: `Imported ${memories} memories into the new space "${result.spaceName}".`,
    import: { spaceId: result.spaceId, counts: result.counts, warnings: result.warnings },
  };
}

export async function executeSpaceOperation(
  args: SpaceOperationArgs,
  context: SpaceOperationContext
): Promise<Record<string, unknown>> {
  const action = (args.action ?? "list").toLowerCase();
  if (WEB_ONLY.includes(action)) {
    return { success: false, error: `Only the web app can ${action} a space.` };
  }
  if (action === "move") {
    return { success: false, error: MOVE_REFUSAL };
  }
  if (action === "export" || action === "import") {
    return runPortabilityAction(action, args, context);
  }
  if (!ACTIONS.includes(action)) {
    return {
      success: false,
      error: `Unknown space action "${args.action}". Actions: ${ACTIONS.join(", ")}.`,
    };
  }
  const name = args.name?.trim();
  if (
    ["create", "archive", "unarchive", "use", "preview", "copy", "link", "unlink"].includes(action)
  ) {
    if (!name) return { success: false, error: `The ${action} action needs a space name.` };
  }
  if ((action === "preview" || action === "copy") && !args.to?.trim()) {
    return { success: false, error: `The ${action} action needs a target space.` };
  }

  try {
    const read = readRegistryFile(context.files.registryPath);
    if (action === "list") {
      return {
        success: true,
        activeSpace: activeOf(read.registry),
        spaces: summary(read.registry),
        ...(read.problem ? { problem: read.problem } : {}),
      };
    }
    if (action === "status") {
      return {
        success: true,
        activeSpace: context.current,
        registryActiveSpace: activeOf(read.registry),
        ...(context.current.problem ? { problem: context.current.problem } : {}),
      };
    }
    if (action === "create") {
      const space = await createStoredSpace(context.files, name!);
      return {
        success: true,
        space: { id: space.id, name: space.name },
        message: `Created space "${space.name}". Use the "use" action to make it active.`,
      };
    }
    if (action === "preview" || action === "copy") {
      return await runTransfer(action, args, context, name!, args.to!.trim());
    }
    if (action === "link" || action === "unlink") {
      return await runLink(action, args, context, name!);
    }
    const change = {
      archive: archiveStoredSpace,
      unarchive: unarchiveStoredSpace,
      use: switchStoredSpace,
    }[action as "archive" | "unarchive" | "use"];
    const registry = await change(context.files, name!);
    const active = activeOf(registry);
    // The caller may have passed the id, so the message names the display name.
    const displayName = findSpace(registry, name!)!.name;
    return {
      success: true,
      activeSpace: active,
      message:
        action === "use"
          ? `Active space is now "${active.name}". It applies from the next turn.`
          : `Space "${displayName}" is now ${action === "archive" ? "archived" : "not archived"}.`,
    };
  } catch (error) {
    if (error instanceof SpaceError) return { success: false, error: error.message };
    throw error;
  }
}
