import type { ImporterModules } from "../web-server.js";
import type { WebServerConfig } from "./port-ownership.js";
import { jsonResponse } from "./static-files.js";

type ImporterApi = Awaited<ReturnType<ImporterModules["api"]>>;
type ImporterJobs = Awaited<ReturnType<ImporterModules["jobs"]>>;

/**
 * What the route modules need from the web server. web-server.ts builds one per
 * server. It passes the importer and the config module in, because web-server.ts
 * is the one services file that may load the importer.
 */
export interface RouteHost {
  /** The web server's settings. The takeover loop can change `port`. */
  readonly config: WebServerConfig;
  readonly importer: ImporterModules;
  loadConfig(): Promise<typeof import("../../config.js")>;
  /** Calls the server's own method, so a test can replace it on the instance. */
  serveStaticFile(filename: string, contentType: string, embedToken?: boolean): Response;
  backfillControls(): Promise<InstanceType<ImporterApi["BackfillControls"]>>;
  importJobs(): Promise<InstanceType<ImporterJobs["SettingsImportJobs"]>>;
  /** The /api/web/* routes, or null for any other path. */
  webControl(
    req: Request,
    path: string,
    method: string,
    remoteAddress: string | undefined
  ): Promise<Response | null>;
  /** The memory store's projects for Directory maps suggestions, read at most once a minute. */
  storeProjects?: {
    readAt: number;
    projects: ReturnType<ImporterApi["readStoreProjects"]>;
  };
}

/** Run an import-page action; errors carry their own status and never file contents. */
export async function importResponse(action: () => unknown, status = 200): Promise<Response> {
  try {
    return jsonResponse(await action(), status);
  } catch (error) {
    const code = (error as { status?: unknown }).status;
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Import request failed" },
      typeof code === "number" ? code : 400
    );
  }
}
