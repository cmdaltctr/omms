import type { ImportHost } from "../importer/import-args.js";
import type { GroupImportJob } from "../importer/web-import-group.js";

export const RECORD_PAST_USAGE = `Usage: om-memory-system skills record-past [options]

Record past turns from every set-up host's history (Pi, OpenCode, Claude Code),
all projects, with no date limit. It calls no model and is safe to run again.
Without --yes the command prints the counts and records nothing.

Options:
  --yes                     Start the run
  --dry-run                 Print the counts only
  --help                    Show this help`;

type Print = (line: string) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hostLines(job: GroupImportJob, dryRun: boolean, label: (host: ImportHost) => string) {
  return job.hosts.map((child) => {
    const s = child.summary;
    const counts = !s
      ? "not run"
      : dryRun
        ? `${s.skillTurnsWouldRecord} to record, ${s.skillTurnsAlreadyRecorded} already recorded`
        : `${s.skillTurnsRecorded} recorded, ${s.skillTurnsAlreadyPresent} already present`;
    return `${label(child.host)}: ${counts}${child.error ? ` (${child.error})` : ""}`;
  });
}

/** `om-memory-system skills record-past`: the same grouped run as the web page. */
export async function runSkillsRecordPast(
  argv: string[],
  print: Print = console.log,
  progress: Print = console.error
): Promise<number> {
  let yes = false;
  let dryRunFlag = false;
  for (const flag of argv) {
    if (flag === "--yes") yes = true;
    else if (flag === "--dry-run") dryRunFlag = true;
    else if (flag === "--help" || flag === "-h") {
      print(RECORD_PAST_USAGE);
      return 0;
    } else {
      print(`Unknown option ${flag}; use --help`);
      return 1;
    }
  }
  const dryRun = dryRunFlag || !yes;
  const { CONFIG, initConfig, initConfigWithLegacyMigration } = await import("../config.js");
  try {
    if (dryRun) initConfig(process.cwd());
    else initConfigWithLegacyMigration(process.cwd());
    if (!CONFIG.skillLearning) {
      print("Skill learning is off. Set skillLearning to true in the global config first.");
      return 1;
    }
    const [{ importReadiness }, { startRecordPastTurns }, { SettingsImportJobs }, { hostLabel }] =
      await Promise.all([
        import("../importer/import-readiness.js"),
        import("../importer/record-past-turns.js"),
        import("../importer/web-import-jobs.js"),
        import("../types/host-label.js"),
      ]);
    const readiness = await importReadiness();
    const jobs = new SettingsImportJobs({ surface: "cli", readiness: async () => readiness });
    await startRecordPastTurns(jobs, process.cwd(), readiness, { dryRun });
    let job = jobs.current() as GroupImportJob;
    let shown = -1;
    while (job.state === "running" || job.state === "cancelling") {
      if (job.processed !== shown) {
        shown = job.processed;
        progress(`Reading past turns: ${job.processed}/${job.total}`);
      }
      await sleep(250);
      job = jobs.current() as GroupImportJob;
    }
    for (const line of hostLines(job, dryRun, hostLabel)) print(line);
    if (job.state !== "done") {
      print(`Record past turns ${job.state}${job.error ? `: ${job.error}` : ""}`);
      return 1;
    }
    if (!dryRunFlag && !yes) print("Run again with --yes to start.");
    return 0;
  } catch (error) {
    print(`Record past turns failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
