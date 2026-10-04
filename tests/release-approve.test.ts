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
  issue?: string;
  body?: string;
  approveExit?: number;
  stable?: string;
}

/** Fake gh, npm and git that log every call and keep state in files. */
function fixture(options: Options = {}) {
  const folder = mkdtempSync(join(tmpdir(), "omms-release-approve-"));
  folders.push(folder);
  const bin = join(folder, "bin");
  mkdirSync(bin);
  const state = (name: string) => join(folder, name);
  writeFileSync(state("latest"), "4.4.2");
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
  "issue list") printf '%s' "${options.issue ?? "7 Approve om-memory-system@4.5.0 on npm"}" ;;
  "issue view") printf '%s\\n' "${options.body ?? `Stage ID: \\\`${STAGE}\\\``}" ;;
  "run list") if [ -f "${state("dispatched")}" ]; then echo 101; else echo 100; fi ;;
  "workflow run") touch "${state("dispatched")}" ;;
  "run watch") exit 0 ;;
esac`
  );
  tool(
    "npm",
    `case "$1 $2" in
  "stage view") echo "om-memory-system@4.5.0" ;;
  "stage approve") [ "${options.approveExit ?? 0}" = 0 ] || exit ${options.approveExit ?? 0}; echo 4.5.0 > "${state("latest")}" ;;
  "view om-memory-system") cat "${state("latest")}" ;;
esac`
  );
  tool(
    "git",
    `case "$*" in
  *refs/heads/stable*) printf '%s\\trefs/heads/stable\\n' "${options.stable ?? TAG_COMMIT}" ;;
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

  it("merges only a passed release pull request, with the App token and the tested commit", () => {
    const merge = workflow("release-auto-merge.yml");
    expect(merge).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(merge).toContain("github.event.workflow_run.event == 'pull_request'");
    expect(merge).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository"
    );
    expect(merge).toContain(
      "startsWith(github.event.workflow_run.head_branch, 'release-please--')"
    );
    expect(merge).toContain("GH_TOKEN: ${{ steps.app-token.outputs.token }}");
    expect(merge).toContain('--match-head-commit "$HEAD_SHA"');
  });

  it("reports a failed release only when npm did not stage it", () => {
    const release = workflow("release.yml");
    expect(release).toContain("staged: ${{ steps.stage.outputs.staged }}");
    expect(release).toContain("needs.publish.outputs.staged != 'true'");
  });

  it("closes the approval issue under the title the Release workflow opens", () => {
    expect(workflow("release.yml")).toContain(
      '--title "Approve om-memory-system@$RELEASE_VERSION on npm"'
    );
    expect(workflow("claude-plugin-channel.yml")).toContain(
      'title="Approve om-memory-system@$version on npm"'
    );
  });
});

describe("release approve script", () => {
  it("approves the staged version, then moves and checks the Claude plugin channel", () => {
    const f = fixture();
    const result = f.run();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
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

  it("stops when no approval issue is open", () => {
    const f = fixture({ issue: "" });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing is waiting for approval");
    expect(f.calls().some((call) => call.startsWith("npm stage approve"))).toBe(false);
  });

  it("stops when the issue has no stage ID", () => {
    const f = fixture({ body: "Stage ID: not found in the log." });
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
    expect(f.calls().some((call) => call.startsWith("npm view"))).toBe(false);
    expect(f.calls().some((call) => call.startsWith("gh workflow run"))).toBe(false);
  });

  it("fails when stable does not reach the release tag", () => {
    const f = fixture({ stable: "b".repeat(40) });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not at v4.5.0");
  });
});
