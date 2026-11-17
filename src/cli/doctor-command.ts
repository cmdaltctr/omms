import type { DoctorRow } from "../core/host-setup.js";
import type { HealthRow } from "../importer/settings-health.js";
import { probe } from "../services/web-ensure.js";
import { webServerUrl } from "../services/web-api-auth.js";
import { doctorRows, type DoctorFacts } from "./doctor-rows.js";
import { detectHosts, type Machine } from "./host-setups.js";

// `om-memory-system doctor`: check Node.js, each host found, the web app port and
// the Settings health rows, then print one row per check with a fix. It changes no
// host file and no setting: the health rows come from the running web app. Like every
// command it records its own copy, and the config load may write the first template.

export const doctorUsage = `Usage: om-memory-system doctor [--json] [--skip-model-test]

Checks Node.js, each host found on this computer, the web app port and the
Settings page health checks. Prints one row per check, with a fix for each
problem. Changes no host file and no setting.

Options:
  --json             Print one JSON array of rows and nothing else
  --skip-model-test  Do not send the short test prompt to the configured models
  --help, -h         Show this help`;

const OPTIONS = ["--json", "--skip-model-test"];
const PROBE_TIMEOUT_MS = 2_000;
const HEALTH_TIMEOUT_MS = 60_000;

export interface DoctorCommandDeps extends Machine {
  nodeVersion: string;
  /** The configured web app address, and Basic Auth when a browser password is set. */
  web(): { host: string; port: number; basicAuth?: { username: string; password: string } };
  /** The local web app token. Called only when the OMMS web app answers. */
  token(): string;
  fetch: typeof fetch;
  /** A test passes a short wait. */
  healthTimeoutMs?: number;
  out(text: string): void;
  err(text: string): void;
}

async function fetchHealth(
  baseUrl: string,
  deps: DoctorCommandDeps,
  testModels: boolean,
  basicAuth: { username: string; password: string } | undefined
): Promise<DoctorFacts["health"]> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-omms-token": deps.token(),
  };
  // The same header the Claude Code hook sends when the web app has a browser password.
  if (basicAuth) {
    const pair = `${basicAuth.username}:${basicAuth.password}`;
    headers.authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
  }
  try {
    const response = await deps.fetch(`${baseUrl}/api/settings/health`, {
      method: "POST",
      headers,
      body: JSON.stringify({ testModels }),
      signal: AbortSignal.timeout(deps.healthTimeoutMs ?? HEALTH_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) return { error: "refused" };
    if (!response.ok) return { error: "failed" };
    const body = (await response.json()) as { checks?: unknown };
    return Array.isArray(body.checks) ? { rows: body.checks as HealthRow[] } : { error: "failed" };
  } catch (error) {
    return {
      error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "failed",
    };
  }
}

function table(rows: DoctorRow[]): string {
  const width = Math.max(...rows.map((row) => row.check.length));
  return rows
    .map((row) => {
      const line = `${row.status.toUpperCase().padEnd(8)} ${row.check.padEnd(width)}  ${row.reason}`;
      return row.fix ? `${line}\n${" ".repeat(9 + width + 2)}Fix: ${row.fix}` : line;
    })
    .join("\n");
}

export async function runDoctorCommand(argv: string[], deps: DoctorCommandDeps): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    deps.out(doctorUsage);
    return 0;
  }
  const unknown = argv.filter((arg) => !OPTIONS.includes(arg));
  if (unknown.length > 0) {
    deps.err(`Unknown option: ${unknown.join(" ")}\n\n${doctorUsage}`);
    return 1;
  }
  const json = argv.includes("--json");
  const testModels = !argv.includes("--skip-model-test");
  const hosts = detectHosts(deps);
  const { host, port, basicAuth } = deps.web();
  const baseUrl = webServerUrl(host, port);
  const answer = await probe(baseUrl, PROBE_TIMEOUT_MS, deps);
  const health = answer === "omms" ? await fetchHealth(baseUrl, deps, testModels, basicAuth) : null;
  // A skipped test row is a warning; a test that ran is a pass or a fail.
  const testRan =
    health && "rows" in health
      ? health.rows.some((row) => row.check.endsWith("model test") && row.status !== "warn")
      : false;
  if (testRan) {
    // Standard output holds only the JSON array, so the note goes to standard error.
    (json ? deps.err : deps.out)(
      "Model test: the web app sent one short test prompt to each configured model. Use --skip-model-test to skip it."
    );
  }
  const rows = doctorRows({
    nodeVersion: deps.nodeVersion,
    hosts: hosts.map((entry) => ({
      id: entry.setup.id,
      name: entry.setup.name,
      minVersion: entry.setup.minVersion,
      found: entry.program !== null,
      version: entry.version,
      registered: entry.registered,
      files: entry.files,
    })),
    web: { probe: answer, port },
    health,
  });
  deps.out(json ? JSON.stringify(rows, null, 2) : table(rows));
  return rows.some((row) => row.status === "fail") ? 1 : 0;
}

/** The real machine, config, token and network. */
export async function productionDoctorDeps(json: boolean): Promise<DoctorCommandDeps> {
  // Loading the config on a first run prints "Created config template" on standard
  // output. With --json, standard output must hold only the array.
  const log = console.log;
  if (json) console.log = console.error;
  try {
    const [{ homedir }, config, { getOrCreateAuthToken }, { WebAuth }] = await Promise.all([
      import("node:os"),
      import("../config.js"),
      import("../services/auth-token.js"),
      import("../services/web-auth.js"),
    ]);
    const home = homedir();
    config.initConfig(home);
    const { CONFIG } = config;
    const password = (CONFIG.webServerAuthPassword ?? "").trim();
    const basicAuth = password
      ? {
          username: new WebAuth({ password, username: CONFIG.webServerAuthUsername }).getConfig()
            .username,
          password,
        }
      : undefined;
    return {
      env: process.env,
      home,
      platform: process.platform,
      nodeVersion: process.versions.node,
      web: () => ({
        host: CONFIG.webServerHost,
        port: CONFIG.webServerPort,
        ...(basicAuth ? { basicAuth } : {}),
      }),
      token: getOrCreateAuthToken,
      fetch,
      out: (text) => log(text),
      err: (text) => console.error(text),
    };
  } finally {
    console.log = log;
  }
}
