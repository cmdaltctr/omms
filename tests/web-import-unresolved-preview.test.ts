import { afterEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CONFIG } from "../src/config.js";
import { matchImportSessions, resolveImportSelection } from "../src/importer/import-sessions.js";
import { readImportSourceToken, validateImportSource } from "../src/importer/import-sources.js";
import { opencodeSnapshots } from "../src/importer/opencode-snapshot.js";
import { runHistoryImport } from "../src/importer/run-import.js";
import { SettingsImportJobs } from "../src/importer/web-import-jobs.js";
import type { GroupImportJob } from "../src/importer/web-import-group.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { fixture } from "./web-import-group-fixture.js";

const dirs: string[] = [];
const handles: DatabaseSync[] = [];
const originalStorage = CONFIG.storagePath;
const originalIgnored = CONFIG.importIgnoredDirectories;
afterEach(async () => {
  await opencodeSnapshots.closeAll();
  await tursoConnectionManager.closeAll();
  CONFIG.storagePath = originalStorage;
  CONFIG.importIgnoredDirectories = originalIgnored;
  for (const db of handles.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
async function finish(jobs: SettingsImportJobs): Promise<GroupImportJob> {
  for (let i = 0; i < 300; i++) {
    const job = jobs.current() as GroupImportJob;
    if (!["running", "cancelling"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("unresolved preview did not finish");
}

for (const entirelyUnresolved of [false, true])
  it(`keeps real-source unresolved counts for ${entirelyUnresolved ? "no-work" : "mixed"} Pi, OpenCode and Claude Code previews`, async () => {
    const data = fixture(dirs, handles);
    const missing = join(data.root, "missing");
    const ignored = join(data.root, "ignored");
    CONFIG.importIgnoredDirectories = [join(ignored, ".")];
    const files = [...data.files];
    const db = handles.at(-1)!;
    db.prepare("INSERT INTO project VALUES (?, ?)").run("missing", missing);
    for (const [id, directory] of [
      ["missing-1", missing],
      ["missing-2", missing],
      ["ignored", ignored],
    ]) {
      const piFile = join(data.pi, `${id}.jsonl`);
      const claudeFile = join(data.claude, "project", `${id}.jsonl`);
      writeFileSync(
        piFile,
        JSON.stringify({
          type: "session",
          version: 3,
          id,
          cwd: directory,
          timestamp: new Date(10).toISOString(),
        }) + "\n"
      );
      writeFileSync(
        claudeFile,
        JSON.stringify({
          type: "user",
          uuid: `${id}-u`,
          sessionId: id,
          cwd: directory,
          timestamp: new Date(20).toISOString(),
          message: { role: "user", content: "Synthetic missing-folder prompt" },
        }) + "\n"
      );
      files.push(piFile, claudeFile);
      db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run(
        id,
        "missing",
        null,
        directory,
        10
      );
    }
    if (entirelyUnresolved) {
      for (const file of data.files.slice(0, 2))
        writeFileSync(file, readFileSync(file, "utf8").replaceAll(data.project, missing));
      db.prepare("UPDATE project SET worktree = ? WHERE id = 'p'").run(missing);
      db.prepare("UPDATE session SET directory = ? WHERE id = 'same'").run(missing);
    }
    const count = entirelyUnresolved ? 3 : 2;
    const cutoff = 35;
    const hosts = await Promise.all(
      (["pi", "opencode", "claude-code"] as const).map(async (host) => {
        const path = host === "pi" ? data.pi : host === "opencode" ? data.dbPath : data.claude;
        const source = validateImportSource(host, path).sourceToken;
        const identity = readImportSourceToken(source, host);
        const options = { host, scope: "all-projects" as const, pathMaps: [], cwd: data.project };
        const listed = await matchImportSessions(identity, options, "fresh");
        expect(listed.unresolved).toHaveLength(count + 1);
        expect(listed.matching.map((row) => row.key)).toEqual(
          entirelyUnresolved
            ? []
            : [host === "pi" ? "same.jsonl" : host === "opencode" ? "same" : "project/same.jsonl"]
        );
        return {
          host,
          source,
          modelChoice: "external",
          selection: { mode: "all", revision: listed.revision, excludedKeys: [], listedAt: cutoff },
        };
      })
    );
    const before = files.map(hash);
    const rootBefore = readdirSync(data.root).sort();
    const calls: string[] = [];
    let modelCalls = 0;
    const jobs = new SettingsImportJobs({
      readiness: async () => ({
        external: { state: "missing-key", provider: "synthetic", model: null },
        opencode: { available: false, models: [] },
        piReader: { available: true },
        claudeCode: {
          available: true,
          defaultRoot: data.claude,
          defaultRootFound: true,
          modelChoices: ["external"],
        },
      }),
      prepareModels: async () => {
        modelCalls++;
        throw new Error("preview must not prepare models");
      },
      runner: async (host, args, run) => {
        calls.push(host);
        expect(args.scope).toBe("all-projects");
        expect(args.dryRun).toBe(true);
        expect(run.models).toEqual({});
        expect(run.selection?.cutoff).toBe(cutoff);
        expect(run.selection?.keys).toEqual([
          host === "pi" ? "same.jsonl" : host === "opencode" ? "same" : "project/same.jsonl",
        ]);
        const report = await runHistoryImport(host, args, run);
        expect(report.unresolvableSessions).toEqual([]);
        expect(report.unresolvedProjects ?? []).toEqual([]);
        return report;
      },
    });
    await jobs.start(
      { hosts, options: { dryRun: true, scope: "all-projects", skipProfile: true } },
      data.project
    );
    const result = await finish(jobs);
    expect(modelCalls).toBe(0);
    expect(calls).toEqual(entirelyUnresolved ? [] : ["pi", "opencode", "claude-code"]);
    expect(result.state).toBe("done");
    expect(result.sessions).toBe(entirelyUnresolved ? 0 : 3);
    expect(files.map(hash)).toEqual(before);
    expect(readdirSync(data.root).sort()).toEqual(rootBefore);
    expect(existsSync(CONFIG.storagePath)).toBe(false);
    expect(result.hosts.map((row) => row.summary?.unresolved)).toEqual([count, count, count]);
    expect(result.summary?.unresolved).toBe(count * 3);
    if (entirelyUnresolved)
      expect(result.hosts.map((row) => row.state)).toEqual(["no-work", "no-work", "no-work"]);
    for (const child of hosts) {
      const resolved = await resolveImportSelection(child.source, child.selection as never, {
        host: child.host,
        scope: "all-projects",
        pathMaps: [],
        cwd: data.project,
        allowEmpty: true,
      });
      expect(resolved).toMatchObject({ cutoff, unresolvedCount: count });
    }
  });
