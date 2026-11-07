import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "../config.js";
import type { RouteResult } from "./chat/chat-routes.js";
import { log } from "./logger.js";
import { packageVersion } from "./package-version.js";
import { getUserTagInfo } from "./tags.js";
import { STATUS_BY_CODE } from "./space-routes.js";
import { exportSpace } from "./spaces/export-space.js";
import {
  IMPORT_MAX_FILE_BYTES,
  importSpace,
  validateSpaceImportDocument,
} from "./spaces/import-space.js";
import {
  SpaceError,
  findSpace,
  readRegistryFile,
  resolveSpaceFolder,
  spaceLinks,
} from "./spaces/registry.js";
import {
  linkStoredSpace,
  spaceFiles,
  unlinkStoredSpace,
  type SpaceFiles,
} from "./spaces/registry-store.js";
import { ommsHomeDir } from "./spaces/storage-resolution.js";
import {
  applySpaceTransfer,
  previewSpaceTransfer,
  type SpaceTransferContext,
  type TransferRefusalCode,
} from "./spaces/transfer-service.js";

/**
 * The transfer, export, import and links routes of design D9. Kept apart from
 * `space-routes.ts` so that file stays under its size ceiling. Every route is a
 * POST under `/api/spaces`, behind the web app's existing token auth; handlers
 * stay thin: parse, call the service, shape the response.
 */

type Body = Record<string, unknown>;

/** A route result; `response` overrides the JSON envelope (the export download). */
export type SpaceTransferRouteResult = RouteResult & { response?: Response };

/** Test seam for the embedder; production falls back to the embedding service. */
export interface SpaceTransferRouteDeps {
  embed?: (text: string) => Promise<Float32Array>;
}

const ok = (data: unknown): SpaceTransferRouteResult => ({
  status: 200,
  body: { success: true, data },
});
const fail = (status: number, code: string, error: string): SpaceTransferRouteResult => ({
  status,
  body: { success: false, code, error },
});

/** A refusal the handler wants mapped to a status and code, like a bad date. */
class RouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** The service refusals of `transfer-service.ts`, as HTTP statuses. */
const STATUS_BY_REFUSAL: Record<TransferRefusalCode, number> = {
  "unknown-space": 404,
  "same-space": 400,
  "archived-space": 409,
  "registry-problem": 500,
};

/** The JSON envelope around the uploaded file (name, folder) may add this much. */
const IMPORT_ENVELOPE_BYTES = 64 * 1024;
/** The import cap of the spec, enforced on the raw request body. */
const IMPORT_BODY_CAP = IMPORT_MAX_FILE_BYTES + IMPORT_ENVELOPE_BYTES;

/** One transfer apply at a time per process (design D4); previews run freely. */
let applyInFlight = false;

function embeddingSettings() {
  return {
    model: config.CONFIG.embeddingModel,
    dimensions: config.CONFIG.embeddingDimensions,
  };
}

function transferContext(files: SpaceFiles, deps?: SpaceTransferRouteDeps): SpaceTransferContext {
  const { storagePath, skillStoragePath, maxVectorsPerShard } = config.CONFIG;
  return {
    files,
    paths: { globalStoragePath: skillStoragePath ?? storagePath, spacesRoot: files.spacesRoot },
    embedding: embeddingSettings(),
    maxVectorsPerShard,
    ...(deps?.embed ? { embed: deps.embed } : {}),
  };
}

function defaultEmbed(text: string): Promise<Float32Array> {
  return import("./embedding.js").then(({ embeddingService }) =>
    embeddingService.embedWithTimeout(text, { task: "document" })
  );
}

/** The importing user: user-scope memories take this user's container tag. */
function importingUser(cwd: string) {
  const info = getUserTagInfo(cwd);
  return {
    userTag: info.tag,
    ...(info.displayName ? { displayName: info.displayName } : {}),
    ...(info.userName ? { userName: info.userName } : {}),
    ...(info.userEmail ? { userEmail: info.userEmail } : {}),
  };
}

async function readJson(req: Request): Promise<Body> {
  return (await req.json().catch(() => ({}))) as Body;
}

/**
 * Reads one import body under the spec's 100 MB cap. The only body limit the
 * web server has lives here, scoped to the import routes.
 */
async function readCappedJson(req: Request): Promise<Body> {
  const declared = Number(req.headers.get("content-length"));
  if (declared > IMPORT_BODY_CAP) {
    throw new RouteError(
      413,
      "file-too-large",
      `The upload is larger than the import limit of ${IMPORT_MAX_FILE_BYTES} bytes.`
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf-8") > IMPORT_BODY_CAP) {
    throw new RouteError(
      413,
      "file-too-large",
      `The upload is larger than the import limit of ${IMPORT_MAX_FILE_BYTES} bytes.`
    );
  }
  try {
    return JSON.parse(text) as Body;
  } catch {
    throw new RouteError(400, "invalid-file", "The request body is not valid JSON.");
  }
}

/** One date field: absent, epoch milliseconds, or an ISO 8601 string. */
function dateMs(body: Body, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new RouteError(400, "invalid-date", `"${field}" must be a date or epoch milliseconds.`);
  }
  return parsed;
}

/** The transfer filter: the whole history by default, one project tag at most. */
function filterFrom(body: Body) {
  const projects = body.projects;
  let projectTag: string | undefined;
  if (Array.isArray(projects)) {
    if (projects.length > 1) {
      throw new RouteError(400, "invalid", "Filter by one project or by none.");
    }
    projectTag = typeof projects[0] === "string" ? projects[0] : undefined;
  } else if (typeof projects === "string" && projects) {
    projectTag = projects;
  }
  return {
    since: dateMs(body, "since") ?? 0,
    until: dateMs(body, "until") ?? Number.MAX_SAFE_INTEGER,
    ...(projectTag ? { projectTag } : {}),
  };
}

function endpoints(body: Body): { from: string; to: string } {
  const from = body.from;
  const to = body.to;
  if (typeof from !== "string" || !from.trim() || typeof to !== "string" || !to.trim()) {
    throw new RouteError(400, "invalid", '"from" and "to" must name two spaces.');
  }
  return { from: from.trim(), to: to.trim() };
}

function transferRefusal(code: TransferRefusalCode, error: string): SpaceTransferRouteResult {
  return fail(STATUS_BY_REFUSAL[code], code, error);
}

/** The download file name of one export: `omms-space-export-<id>-<timestamp>.json`. */
function exportFileName(spaceId: string): string {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `omms-space-export-${spaceId}-${stamp}.json`;
}

async function handleExport(id: string, req: Request): Promise<SpaceTransferRouteResult> {
  const files = spaceFiles(ommsHomeDir());
  const read = readRegistryFile(files.registryPath);
  const space = findSpace(read.registry, id);
  if (!space) return fail(404, "unknown", `No space named "${id}".`);
  const body = await readJson(req);
  const { storagePath, skillStoragePath } = config.CONFIG;
  // One name for the file, the header and the clean-up, so all three agree.
  const fileName = exportFileName(space.id);
  const outPath = join(tmpdir(), fileName);
  const since = dateMs(body, "since");
  const until = dateMs(body, "until");
  try {
    const result = await exportSpace({
      folder: resolveSpaceFolder(space.id, {
        globalStoragePath: skillStoragePath ?? storagePath,
        spacesRoot: files.spacesRoot,
      }),
      outPath,
      ...(since !== undefined ? { since } : {}),
      ...(until !== undefined ? { until } : {}),
      includeProfile: body.includeProfile === true,
      embeddingModel: config.CONFIG.embeddingModel,
      embeddingDimensions: config.CONFIG.embeddingDimensions,
      ommsVersion: packageVersion(),
      homePath: homedir(),
    });
    if (!result.written) return ok(result);
    // The bytes the CLI would write go out unchanged, as an attachment.
    const bytes = readFileSync(outPath);
    return {
      status: 200,
      body: undefined,
      response: new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="${fileName}"`,
          "x-omms-export-info": JSON.stringify({
            counts: result.counts,
            warnings: result.warnings,
          }),
        },
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The export failed.";
    return fail(500, "export-failed", message);
  } finally {
    if (existsSync(outPath)) unlinkSync(outPath);
  }
}

async function handleImportCheck(req: Request, cwd: string): Promise<SpaceTransferRouteResult> {
  const body = await readCappedJson(req);
  if (body.document === undefined) {
    return fail(400, "invalid-file", "No export document was given.");
  }
  const validated = validateSpaceImportDocument(
    body.document,
    embeddingSettings(),
    importingUser(cwd).userTag
  );
  if (!validated.ok) return fail(400, "invalid-file", validated.reason);
  const projects: string[] = [];
  for (const memory of validated.document.memories) {
    if (memory.scope === "project" && memory.projectTag && !projects.includes(memory.projectTag)) {
      projects.push(memory.projectTag);
    }
  }
  return ok({
    counts: validated.counts,
    projects,
    // Structured, so the dialog composes its localised warning (web spec: every
    // string exists in en, zh and ar). `warning` stays for non-UI callers.
    embedding: {
      fileModel: validated.document.embedding.model,
      fileDimensions: validated.document.embedding.dimensions,
      currentModel: config.CONFIG.embeddingModel,
      currentDimensions: config.CONFIG.embeddingDimensions,
    },
    ...(validated.warning ? { warning: validated.warning } : {}),
  });
}

async function handleImport(
  req: Request,
  cwd: string,
  deps?: SpaceTransferRouteDeps
): Promise<SpaceTransferRouteResult> {
  const files = spaceFiles(ommsHomeDir());
  const body = await readCappedJson(req);
  if (body.document === undefined) {
    return fail(400, "invalid-file", "No export document was given.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail(400, "invalid", "A name for the new space is required.");

  // Precise refusals first, so no space is ever created for a bad request.
  const validated = validateSpaceImportDocument(
    body.document,
    embeddingSettings(),
    importingUser(cwd).userTag
  );
  if (!validated.ok) return fail(400, "invalid-file", validated.reason);
  if (findSpace(readRegistryFile(files.registryPath).registry, name)) {
    return fail(409, "name-taken", `A space named "${name}" already exists.`);
  }
  const retagToProject =
    typeof body.retagToProject === "string" && body.retagToProject.trim()
      ? body.retagToProject.trim()
      : undefined;
  if (retagToProject !== undefined && !existsSync(retagToProject)) {
    return fail(
      400,
      "missing-folder",
      `The project folder "${retagToProject}" does not exist, so no space was created.`
    );
  }

  const result = await importSpace({
    document: body.document,
    spaceName: name,
    files,
    ...(retagToProject !== undefined ? { retagToProject } : {}),
    embedding: embeddingSettings(),
    embed: deps?.embed ?? defaultEmbed,
    user: importingUser(cwd),
  });
  if (!result.ok) return fail(400, "import-failed", result.reason ?? "The import failed.");
  return ok(result);
}

async function handleLinks(id: string, req: Request): Promise<SpaceTransferRouteResult> {
  const files = spaceFiles(ommsHomeDir());
  const body = await readJson(req);
  const add = typeof body.add === "string" && body.add.trim() ? body.add.trim() : undefined;
  const remove =
    typeof body.remove === "string" && body.remove.trim() ? body.remove.trim() : undefined;
  if ((add !== undefined) === (remove !== undefined)) {
    return fail(400, "invalid", 'Give either "add" or "remove", naming one space.');
  }
  if (add) await linkStoredSpace(files, id, add);
  else await unlinkStoredSpace(files, id, remove!);
  return ok({ links: spaceLinks(readRegistryFile(files.registryPath).registry, id) });
}

async function dispatch(
  path: string,
  req: Request,
  cwd: string,
  deps?: SpaceTransferRouteDeps
): Promise<SpaceTransferRouteResult | undefined> {
  if (path === "/api/spaces/transfer/preview") {
    const body = await readJson(req);
    const { from, to } = endpoints(body);
    const outcome = await previewSpaceTransfer(
      { from, to, filter: filterFrom(body) },
      transferContext(spaceFiles(ommsHomeDir()), deps)
    );
    if (!outcome.ok) return transferRefusal(outcome.code, outcome.error);
    return ok({ preview: outcome.preview });
  }

  if (path === "/api/spaces/transfer") {
    const body = await readJson(req);
    const { from, to } = endpoints(body);
    if (body.mode !== "copy" && body.mode !== "move") {
      return fail(400, "invalid", '"mode" must be "copy" or "move".');
    }
    if (body.confirm !== true) {
      return fail(400, "confirm-required", "Set confirm to true to run the transfer.");
    }
    if (applyInFlight) {
      return fail(
        STATUS_BY_CODE["transfer-busy"],
        "transfer-busy",
        "Another transfer is running. Try again when it finishes."
      );
    }
    applyInFlight = true;
    try {
      const outcome = await applySpaceTransfer(
        {
          from,
          to,
          filter: filterFrom(body),
          mode: body.mode,
          ...(typeof body.previewMatched === "number"
            ? { previewMatched: body.previewMatched }
            : {}),
        },
        transferContext(spaceFiles(ommsHomeDir()), deps)
      );
      if (!outcome.ok) return transferRefusal(outcome.code, outcome.error);
      return ok({ result: outcome.result });
    } finally {
      applyInFlight = false;
    }
  }

  const exported = /^\/api\/spaces\/([^/]+)\/export$/.exec(path);
  if (exported) return handleExport(decodeURIComponent(exported[1]!), req);

  if (path === "/api/spaces/import/check") return handleImportCheck(req, cwd);
  if (path === "/api/spaces/import") return handleImport(req, cwd, deps);

  const links = /^\/api\/spaces\/([^/]+)\/links$/.exec(path);
  if (links) return handleLinks(decodeURIComponent(links[1]!), req);

  return undefined;
}

export async function routeSpaceTransfers(
  path: string,
  method: string,
  req: Request,
  cwd: string,
  deps?: SpaceTransferRouteDeps
): Promise<SpaceTransferRouteResult | undefined> {
  if (method !== "POST" || !path.startsWith("/api/spaces/")) return undefined;
  try {
    return await dispatch(path, req, cwd, deps);
  } catch (error) {
    if (error instanceof RouteError) return fail(error.status, error.code, error.message);
    if (error instanceof SpaceError) {
      return fail(STATUS_BY_CODE[error.code] ?? 400, error.code, error.message);
    }
    log(
      "space transfer route: error",
      { path, name: error instanceof Error ? error.name : typeof error },
      "error"
    );
    return fail(500, "error", error instanceof Error ? error.message : "Request failed");
  }
}
