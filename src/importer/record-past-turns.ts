import type { ImportHost } from "./import-args.js";
import type { ImportReadiness } from "./import-readiness.js";
import type { ImportSelection } from "./import-sessions.js";
import {
  ImportJobError,
  type GroupImportRequest,
  type SettingsImportJobs,
} from "./web-import-jobs.js";

/**
 * **Record past turns** (design decision 11): one skill-turns-only grouped
 * import over every set-up host, all projects and every session, with no date
 * limit. It runs through the grouped-import job, so the Memory page shows its
 * progress, and it calls no model. Safe to run again: `turn_key` drops copies.
 */

const HOSTS: ImportHost[] = ["pi", "opencode", "claude-code"];

/** Hosts whose default history exists on this computer and whose reader loads. */
export function setUpHosts(readiness: ImportReadiness): ImportHost[] {
  return HOSTS.filter(
    (host) => readiness.defaultSourceFound[host] && (host !== "pi" || readiness.piReader.available)
  );
}

/**
 * The grouped request for every set-up host. Each host lists its default
 * source now, so the selection is every session up to this moment, including
 * sessions the memory ledger marks handled.
 */
export async function recordPastTurnsRequest(
  cwd: string,
  readiness: ImportReadiness,
  options: { dryRun?: boolean } = {}
): Promise<GroupImportRequest> {
  const { listImportSessions } = await import("./import-sessions.js");
  const hosts: GroupImportRequest["hosts"] = [];
  for (const host of setUpHosts(readiness)) {
    const page = await listImportSessions(
      { refresh: true, includeHandled: true, limit: 1 },
      {
        host,
        scope: "all-projects",
        pathMaps: [],
        cwd,
        outputs: { memories: false, profile: false },
        // Matches the job's skills-only options, so sessions whose folder is gone are kept.
        skillTurnsOnly: true,
      }
    );
    const selection: ImportSelection = {
      mode: "all",
      excludedKeys: [],
      revision: page.revision,
      listedAt: page.listedAt,
      includeHandled: true,
    };
    hosts.push({
      host,
      source: page.source.sourceToken,
      selection,
      // Claude Code imports name the external API; this run never calls it.
      ...(host === "claude-code" ? { modelChoice: "external" } : {}),
    });
  }
  return {
    hosts,
    options: {
      skipMemories: true,
      skipProfile: true,
      scope: "all-projects",
      ...(options.dryRun ? { dryRun: true } : {}),
    },
  };
}

/** Start **Record past turns** in a job slot: the web app's own, or a new one in the terminal. */
export async function startRecordPastTurns(
  jobs: SettingsImportJobs,
  cwd: string,
  readiness: ImportReadiness,
  options: { dryRun?: boolean } = {}
) {
  const request = await recordPastTurnsRequest(cwd, readiness, options);
  if (request.hosts.length === 0) {
    throw new ImportJobError("No Pi, OpenCode or Claude Code history was found on this computer");
  }
  return jobs.start(request, cwd);
}
