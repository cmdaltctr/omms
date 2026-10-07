import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const script = resolve(join(import.meta.dir, "../scripts/release-approve.sh"));
const STAGE = "2e27b81a-5edd-4ea8-b586-989b9d6c2480";
const TAG_COMMIT = "a".repeat(40);
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

interface Options {
  latest?: string;
  body?: string;
  approveExit?: number;
  /** Where stable points before the run. */
  stable?: string;
  /** The channel workflow moves stable to the release tag. */
  moves?: boolean;
  /** npm shows the new version once the approval succeeds. Default true. */
  publishes?: boolean;
  /** The dispatched channel run appears in the run list. Default true. */
  starts?: boolean;
}

/** Fake gh, npm and git that log every call and keep state in files. */
function fixture(options: Options = {}) {
  const folder = mkdtempSync(join(tmpdir(), "omms-release-approve-"));
  folders.push(folder);
  const bin = join(folder, "bin");
  mkdirSync(bin);
  const state = (name: string) => join(folder, name);
  writeFileSync(state("latest"), options.latest ?? "4.4.2");
  writeFileSync(state("stable"), options.stable ?? TAG_COMMIT);
  const tool = (name: string, body: string) =>
    writeFileSync(
      join(bin, name),
      `#!/bin/bash\necho "${name} $*" >> "${state("calls")}"\n${body}\n`,
      { mode: 0o755 }
    );
  // The fake ignores --jq and prints what gh would print after it.
  tool(
    "gh",
    `case "$1 $2" in
  "release view") if [ "$3" = --repo ]; then echo v4.5.0; else printf '%s\\n' "${options.body ?? `Approve it, or run \\\`npm stage approve ${STAGE}\\\` (2FA).`}"; fi ;;
  "run list") if [ -f "${state("dispatched")}" ] && [ "${options.starts ?? true}" = true ]; then echo 101; else echo 100; fi ;;
  "workflow run") touch "${state("dispatched")}"; if [ "${options.moves ?? false}" = true ]; then echo ${TAG_COMMIT} > "${state("stable")}"; fi ;;
  "run watch") exit 0 ;;
esac`
  );
  tool(
    "npm",
    `case "$1 $2" in
  "stage view") echo "om-memory-system@4.5.0" ;;
  "stage approve") [ "${options.approveExit ?? 0}" = 0 ] || exit ${options.approveExit ?? 0}; if [ "${options.publishes ?? true}" = true ]; then echo 4.5.0 > "${state("latest")}"; fi ;;
  "view om-memory-system")
    case " $* " in
      *" --prefer-online "*) cat "${state("latest")}" ;;
      *) echo 4.4.2 ;;
    esac ;;
esac`
  );
  tool(
    "git",
    `case "$*" in
  *refs/heads/stable*) printf '%s\\trefs/heads/stable\\n' "$(cat "${state("stable")}")" ;;
  *refs/tags/v4.5.0*) printf '%s\\trefs/tags/v4.5.0\\n' "${TAG_COMMIT}" ;;
esac`
  );
  const run = (...args: string[]) => {
    const env = {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      OMMS_RELEASE_POLL_SECONDS: "0",
    };
    return spawnSync("bash", [script, ...args], { env, encoding: "utf8" });
  };
  const calls = () =>
    existsSync(state("calls")) ? readFileSync(state("calls"), "utf8").trim().split("\n") : [];
  return { run, calls };
}

describe("release automation workflows", () => {
  const workflow = (name: string) =>
    readFileSync(join(import.meta.dir, "../.github/workflows", name), "utf8");

  it("merges only a passed release pull request that the guard accepts", () => {
    const merge = workflow("release-auto-merge.yml");
    expect(merge).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(merge).toContain("github.event.workflow_run.event == 'pull_request'");
    expect(merge).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository"
    );
    expect(merge).toContain("GH_TOKEN: ${{ steps.app-token.outputs.token }}");
    expect(merge).toContain('--match-head-commit "$HEAD_SHA"');
    // The guard runs from main before the merge, and the PR code is never checked out.
    expect(merge).toMatch(/ref: main\n\s+persist-credentials: false/);
    const guard = merge.indexOf(
      'node scripts/release-pr-guard.mjs guard "$RELEASE_BOT" "$HEAD_SHA"'
    );
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(merge.indexOf("gh pr merge"));
  });

  it("reports a failed release only when npm did not stage it", () => {
    const release = workflow("release.yml");
    expect(release).toContain("staged: ${{ steps.stage.outputs.staged }}");
    expect(release).toContain("needs.publish.outputs.staged != 'true'");
  });

  it("tells the maintainer with a mention on the release pull request, not an issue", () => {
    const release = workflow("release.yml");
    expect(release).not.toContain("gh issue");
    expect(release.match(/gh pr comment "\$pr"/g)?.length).toBe(2);
    expect(release.match(/echo "@\$OWNER /g)?.length).toBe(2);
    expect(release).toContain("npm stage approve $STAGE_ID");
  });
});

describe("release approve script", () => {
  it("approves the staged version, then moves and checks the Claude plugin channel", () => {
    const f = fixture();
    const result = f.run();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const views = f.calls().filter((call) => call.startsWith("npm view "));
    expect(views).toHaveLength(3);
    expect(views.every((call) => call.endsWith(" version --prefer-online"))).toBe(true);
    expect(f.calls()).toContain(`npm stage approve ${STAGE}`);
    expect(f.calls()).toContain(
      "gh workflow run claude-plugin-channel.yml --repo cmdaltctr/omms --ref main"
    );
    expect(f.calls()).toContain("gh run watch 101 --repo cmdaltctr/omms --exit-status");
    expect(result.stdout).toContain("Released om-memory-system@4.5.0");
  });

  it("uses a stage ID passed on the command line", () => {
    const other = "11111111-2222-3333-4444-555555555555";
    const f = fixture();
    expect(f.run(other).status).toBe(0);
    expect(f.calls()).toContain(`npm stage approve ${other}`);
  });

  it("skips the approval and moves the channel when the release is already on npm", () => {
    // The release was approved another way, or an earlier run stopped before the channel.
    const f = fixture({ latest: "4.5.0", stable: "b".repeat(40), moves: true });
    const result = f.run();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const calls = f.calls();
    expect(calls.some((call) => call.startsWith("npm stage"))).toBe(false);
    expect(calls).toContain(
      "gh workflow run claude-plugin-channel.yml --repo cmdaltctr/omms --ref main"
    );
    expect(result.stdout).toContain("Released om-memory-system@4.5.0");
  });

  it("does nothing when the release is on npm and stable is already at its tag", () => {
    const f = fixture({ latest: "4.5.0" });
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Nothing to do");
    const calls = f.calls();
    expect(calls.some((call) => call.startsWith("npm stage"))).toBe(false);
    expect(calls.some((call) => call.startsWith("gh workflow run"))).toBe(false);
  });

  it("tells you to run it again when npm does not show the version after the approval", () => {
    const f = fixture({ publishes: false });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bun run release:approve");
    expect(result.stderr).not.toContain("hourly");
    expect(f.calls().some((call) => call.startsWith("gh workflow run"))).toBe(false);
  });

  it("tells you to run it again when the channel run does not start", () => {
    const f = fixture({ starts: false });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bun run release:approve");
    expect(result.stderr).not.toContain("hourly");
  });

  it("stops when the release note has no stage ID", () => {
    const f = fixture({ body: "Approve it, or run `npm stage approve <stage-id>` (2FA)." });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No stage ID");
    expect(f.calls().some((call) => call.startsWith("npm stage approve"))).toBe(false);
  });

  it("does not move the channel when the approval fails", () => {
    const f = fixture({ approveExit: 1 });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run 'npm login'");
    const calls = f.calls();
    const approved = calls.findIndex((call) => call.startsWith("npm stage approve"));
    expect(calls.slice(approved + 1)).toEqual([]);
  });

  it("fails when stable does not reach the release tag", () => {
    const f = fixture({ stable: "b".repeat(40) });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not at v4.5.0");
  });
});
