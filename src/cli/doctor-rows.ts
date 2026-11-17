import type { DoctorRow, HostId, SetupFileCheck } from "../core/host-setup.js";
import type { HealthRow } from "../importer/settings-health.js";
import type { Probe } from "../services/web-ensure.js";
import { compareVersions } from "../services/version-compare.js";

// The `doctor` rows, built from facts only. `doctor-command.ts` gathers the facts.

/** The Node.js version in `package.json` `engines`. */
export const NODE_MINIMUM = "22.14.0";

export interface DoctorHostFacts {
  id: HostId;
  name: string;
  minVersion: string;
  /** False when the host is not installed; such a host gets no row. */
  found: boolean;
  version: string | null;
  registered: boolean;
  files: Array<Pick<SetupFileCheck, "check" | "state" | "reason" | "fix">>;
}

/** Why a running OMMS web app gave no health rows. */
export type HealthError = "timeout" | "refused" | "failed";

const HEALTH_ERROR_REASONS: Record<HealthError, string> = {
  timeout: "Skipped: the web app took too long to run its checks.",
  refused: "Skipped: the web app refused the request for its checks.",
  failed: "Skipped: the web app could not run its checks.",
};
const HEALTH_ERROR_FIX =
  "Open the Settings page, go to Health and select Run checks. Or run doctor again with --skip-model-test.";

export interface DoctorFacts {
  nodeVersion: string;
  hosts: DoctorHostFacts[];
  web: { probe: Probe; port: number };
  /** The Settings health rows, or why they could not be fetched. Null when no OMMS web app answers. */
  health: { rows: HealthRow[] } | { error: HealthError } | null;
}

const SETUP_FIX = "Run: npx om-memory-system@latest setup";
const START_FIX = "Start the web app with: npx om-memory-system@latest web";
/** The health rows `doctor` expects from a running web app, by host. */
const HEALTH_ROWS: Array<[string, HostId | null]> = [
  ["Embedding", null],
  ["OpenCode model", "opencode"],
  ["Pi model", "pi"],
  ["Claude Code model", "claude-code"],
];

const pass = (check: string, reason: string, host: HostId | null): DoctorRow => ({
  check,
  status: "pass",
  reason,
  fix: "",
  host,
});

function nodeRow(version: string): DoctorRow {
  const older = (compareVersions(version.replace(/^v/, ""), NODE_MINIMUM) ?? -1) < 0;
  if (!older) return pass("Node.js", `Node.js ${version}`, null);
  return {
    check: "Node.js",
    status: "fail",
    reason: `Node.js ${version} is older than ${NODE_MINIMUM}.`,
    fix: "Install Node.js 22.14 or later, then run this command again.",
    host: null,
  };
}

function hostRows(host: DoctorHostFacts): DoctorRow[] {
  const rows: DoctorRow[] = [];
  const minimum = host.minVersion;
  if (host.version === null) {
    rows.push({
      check: `${host.name} version`,
      status: "warn",
      reason: `${host.name} is installed, but its version could not be read.`,
      fix: `Check that "${host.name}" runs, then update it to ${minimum} or later.`,
      host: host.id,
    });
  } else if ((compareVersions(host.version, minimum) ?? 0) < 0) {
    rows.push({
      check: `${host.name} version`,
      status: "fail",
      reason: `${host.name} ${host.version} is older than ${minimum}.`,
      fix: `Update ${host.name} to ${minimum} or later.`,
      host: host.id,
    });
  } else rows.push(pass(`${host.name} version`, `${host.name} ${host.version}`, host.id));
  rows.push(
    host.registered
      ? pass(`${host.name} plugin`, `OMMS is set up in ${host.name}.`, host.id)
      : {
          check: `${host.name} plugin`,
          status: "fail",
          reason: `OMMS is not set up in ${host.name}.`,
          fix: SETUP_FIX,
          host: host.id,
        }
  );
  for (const file of host.files) {
    rows.push(
      file.state === "present"
        ? pass(file.check, "The entry is in place.", host.id)
        : { check: file.check, status: "warn", reason: file.reason, fix: file.fix, host: host.id }
    );
  }
  return rows;
}

function webRow(web: DoctorFacts["web"]): DoctorRow {
  if (web.probe === "omms")
    return pass("Web app", `The OMMS web app answers on port ${web.port}.`, null);
  if (web.probe === "other") {
    return {
      check: "Web app",
      status: "fail",
      reason: `Another program answers on port ${web.port}, so the OMMS web app cannot start.`,
      fix: 'Stop that program, or set "webServerPort" in the global config to a free port.',
      host: null,
    };
  }
  return {
    check: "Web app",
    status: "warn",
    reason: `No web app answers on port ${web.port}. Each host starts it when needed.`,
    fix: START_FIX,
    host: null,
  };
}

/** A model test only the host can run: nothing is wrong, so it is skipped with no fix. */
function hostModelRow(row: HealthRow, names: Map<HostId, string>): DoctorRow {
  const name = (row.host && names.get(row.host)) || "This host";
  return {
    check: row.check,
    status: "skipped",
    reason: `Skipped: ${name} uses its own model, which only a session in ${name} can test. Nothing to do.`,
    fix: "",
    host: row.host ?? null,
  };
}

function healthRows(facts: DoctorFacts, found: Set<HostId>): DoctorRow[] {
  const keep = (host: HostId | null | undefined) => !host || found.has(host);
  if (facts.health && "rows" in facts.health) {
    const names = new Map(facts.hosts.map((host) => [host.id, host.name]));
    return facts.health.rows
      .filter((row) => keep(row.host))
      .map((row) =>
        row.hostModelOnly
          ? hostModelRow(row, names)
          : {
              check: row.check,
              status: row.status,
              reason: row.reason,
              fix: row.status === "pass" ? "" : (row.fix ?? "Open the Settings page for details."),
              host: row.host ?? null,
            }
      );
  }
  const error = facts.health && "error" in facts.health ? facts.health.error : null;
  const reason = error
    ? HEALTH_ERROR_REASONS[error]
    : "Skipped: this check runs in the OMMS web app, which is not running.";
  const fix = error
    ? HEALTH_ERROR_FIX
    : facts.web.probe === "other"
      ? 'Free the port or set "webServerPort", then run doctor again.'
      : START_FIX;
  return HEALTH_ROWS.filter(([, host]) => keep(host)).map(([check, host]) => ({
    check,
    status: "skipped",
    reason,
    fix,
    host,
  }));
}

/** Every `doctor` row, machine rows first. A host that is not found gets no row. */
export function doctorRows(facts: DoctorFacts): DoctorRow[] {
  const found = facts.hosts.filter((host) => host.found);
  return [
    nodeRow(facts.nodeVersion),
    ...found.flatMap(hostRows),
    webRow(facts.web),
    ...healthRows(facts, new Set(found.map((host) => host.id))),
  ];
}
