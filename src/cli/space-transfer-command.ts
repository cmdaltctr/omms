import { homedir } from "node:os";
import type { SpacePortability } from "../services/spaces/operations.js";
import type { SpaceFiles } from "../services/spaces/registry-store.js";

/**
 * The `space export` and `space import` runners (design D8). Both are CLI-only: the
 * `memory` tool `space` mode refuses them. This file is the one place that bridges
 * CONFIG into `exportSpace` and `importSpace`, which themselves never read CONFIG;
 * the shared space operation runs them only when the CLI hands it this bridge.
 */

export interface SpaceExportCliRequest {
  /** The space to export: a name or id. */
  name: string;
  outPath: string;
  since?: string;
  until?: string;
  includeProfile?: boolean;
}

export interface SpaceImportCliRequest {
  /** Path of the export file to read. */
  filePath: string;
  /** The name of the new space the file becomes. */
  name: string;
  retagToProject?: string;
}

/** The bridge the CLI hands the shared operation: the export/import capability made real. */
async function portabilityBridge(files: SpaceFiles, directory: string): Promise<SpacePortability> {
  const { CONFIG } = await import("../config.js");
  return {
    export: async (request) => {
      const { exportSpace, getOmmsVersion } = await import("../services/spaces/export-space.js");
      return exportSpace({
        ...request,
        embeddingModel: CONFIG.embeddingModel,
        embeddingDimensions: CONFIG.embeddingDimensions,
        ommsVersion: getOmmsVersion(),
        homePath: homedir(),
      });
    },
    import: async (request) => {
      const { importSpace } = await import("../services/spaces/import-space.js");
      const { embeddingService } = await import("../services/embedding.js");
      const { getTags } = await import("../services/tags.js");
      const user = getTags(directory).user;
      return importSpace({
        ...request,
        files,
        embedding: { model: CONFIG.embeddingModel, dimensions: CONFIG.embeddingDimensions },
        embed: (text: string) => embeddingService.embedWithTimeout(text, { task: "document" }),
        user: {
          userTag: user.tag,
          displayName: user.displayName,
          ...(user.userName ? { userName: user.userName } : {}),
          ...(user.userEmail ? { userEmail: user.userEmail } : {}),
        },
      });
    },
  };
}

/** Runs `space export <name> --out <file>` through the shared space operation. */
export async function runSpaceExport(
  request: SpaceExportCliRequest,
  directory: string
): Promise<Record<string, unknown>> {
  const { CONFIG, getActiveSpace, initConfig } = await import("../config.js");
  initConfig(directory);
  const { executeSpaceOperation } = await import("../services/spaces/operations.js");
  const { spaceFiles } = await import("../services/spaces/registry-store.js");
  const { ommsHomeDir } = await import("../services/spaces/storage-resolution.js");
  const { spaceOperationSettings } = await import("../core/space-tool.js");
  const files = spaceFiles(ommsHomeDir());
  return executeSpaceOperation(
    {
      action: "export",
      name: request.name,
      outPath: request.outPath,
      ...(request.since === undefined ? {} : { since: request.since }),
      ...(request.until === undefined ? {} : { until: request.until }),
      ...(request.includeProfile ? { includeProfile: true } : {}),
    },
    {
      files,
      current: getActiveSpace(),
      settings: spaceOperationSettings(CONFIG, files.spacesRoot),
      portability: await portabilityBridge(files, directory),
    }
  );
}

/** Runs `space import <file> --name <new>` through the shared space operation. */
export async function runSpaceImport(
  request: SpaceImportCliRequest,
  directory: string
): Promise<Record<string, unknown>> {
  const { CONFIG, getActiveSpace, initConfig } = await import("../config.js");
  initConfig(directory);
  const { executeSpaceOperation } = await import("../services/spaces/operations.js");
  const { spaceFiles } = await import("../services/spaces/registry-store.js");
  const { ommsHomeDir } = await import("../services/spaces/storage-resolution.js");
  const { spaceOperationSettings } = await import("../core/space-tool.js");
  const files = spaceFiles(ommsHomeDir());
  return executeSpaceOperation(
    {
      action: "import",
      name: request.name,
      filePath: request.filePath,
      ...(request.retagToProject === undefined ? {} : { retagToProject: request.retagToProject }),
    },
    {
      files,
      current: getActiveSpace(),
      settings: spaceOperationSettings(CONFIG, files.spacesRoot),
      portability: await portabilityBridge(files, directory),
    }
  );
}
