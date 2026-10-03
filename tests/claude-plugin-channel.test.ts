import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const script = resolve(
  process.env.OMMS_CHANNEL_SCRIPT ??
    join(import.meta.dir, "../scripts/sync-claude-plugin-channel.sh")
);
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function fixture(stableVersion: string | null = "4.4.1") {
  const folder = mkdtempSync(join(tmpdir(), "omms-channel-"));
  folders.push(folder);
  const origin = join(folder, "origin.git");
  const repo = join(folder, "repo");
  const bin = join(folder, "bin");
  mkdirSync(bin);
  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Channel test",
        GIT_AUTHOR_EMAIL: "channel@example.test",
        GIT_COMMITTER_NAME: "Channel test",
        GIT_COMMITTER_EMAIL: "channel@example.test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(["init", "--bare", origin], folder);
  git(["init", "--initial-branch=main", repo], folder);
  git(["config", "core.hooksPath", join(folder, "no-hooks")]);
  git(["remote", "add", "origin", origin]);
  const commits: Record<string, string> = {};
  for (const version of ["4.4.1", "4.5.0"]) {
    git(["commit", "--allow-empty", "-m", `Release ${version}`]);
    git(["tag", `v${version}`]);
    commits[version] = git(["rev-parse", "HEAD"]);
  }
  git(["push", "origin", "main", "--tags"]);
  if (stableVersion) git(["push", "origin", `${commits[stableVersion]}:refs/heads/stable`]);
  git(["fetch", "origin"]);
  // A receive hook records which remote refs the script changes.
  git(["config", "core.hooksPath", "hooks"], origin);
  writeFileSync(join(origin, "hooks/update"), '#!/bin/sh\nprintf "%s\\n" "$1" >> pushed-refs\n', {
    mode: 0o755,
  });
  const refs = () => git(["for-each-ref", "--format=%(refname) %(objectname)"], origin);
  const stable = () => git(["rev-parse", "refs/heads/stable"], origin);
  const pushed = () =>
    existsSync(join(origin, "pushed-refs"))
      ? readFileSync(join(origin, "pushed-refs"), "utf8").trim().split("\n")
      : [];
  const curl = (body: string) =>
    writeFileSync(join(bin, "curl"), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  const race = () => {
    git(["commit", "--allow-empty", "-m", "Concurrent update"]);
    const concurrent = git(["rev-parse", "HEAD"]);
    git(["push", "origin", `${concurrent}:refs/heads/concurrent`]);
    // Keep the local tracking ref stale, as if another run pushed after checkout.
    git(["update-ref", "refs/heads/stable", concurrent], origin);
    return concurrent;
  };
  const run = (version?: string) => {
    expect(existsSync(script)).toBe(true);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    delete env.OMMS_NPM_LATEST;
    if (version !== undefined) env.OMMS_NPM_LATEST = version;
    return spawnSync("bash", [script], { cwd: repo, env, encoding: "utf8" });
  };
  return { commits, refs, stable, pushed, curl, race, run };
}

describe("Claude plugin stable channel", () => {
  it("moves stable to the release tag named by npm latest", () => {
    const f = fixture();
    const result = f.run("4.5.0");
    expect(result.status).toBe(0);
    expect(f.stable()).toBe(f.commits["4.5.0"]);
  });

  it("does nothing when stable already names the release", () => {
    const f = fixture();
    const before = f.refs();
    const result = f.run("4.4.1");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already at v4.4.1");
    expect(f.refs()).toBe(before);
    expect(f.pushed()).toEqual([]);
  });

  it("rolls stable back when npm latest names an older release", () => {
    const f = fixture("4.5.0");
    expect(f.run("4.4.1").status).toBe(0);
    expect(f.stable()).toBe(f.commits["4.4.1"]);
  });

  it("fails with the missing tag's name and leaves refs unchanged", () => {
    const f = fixture();
    const before = f.refs();
    const result = f.run("4.6.0");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("v4.6.0");
    expect(f.refs()).toBe(before);
    expect(f.pushed()).toEqual([]);
  });

  it.each(["4.5.0-next.1", "latest", "4.5", "4.5.0+build", "", "4.5.0\n"])(
    "refuses invalid or prerelease version %j",
    (version) => {
      const f = fixture();
      const before = f.refs();
      const result = f.run(version);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid stable version");
      expect(f.refs()).toBe(before);
      expect(f.pushed()).toEqual([]);
    }
  );

  it("creates stable when the remote branch does not exist", () => {
    const f = fixture(null);
    expect(f.run("4.4.1").status).toBe(0);
    expect(f.stable()).toBe(f.commits["4.4.1"]);
    expect(f.pushed()).toEqual(["refs/heads/stable"]);
  });

  it("pushes only stable, preserving main and release tags", () => {
    const f = fixture();
    const withoutStable = (refs: string) =>
      refs.split("\n").filter((ref) => !ref.startsWith("refs/heads/stable "));
    const before = withoutStable(f.refs());
    expect(f.run("4.5.0").status).toBe(0);
    expect(f.pushed()).toEqual(["refs/heads/stable"]);
    expect(withoutStable(f.refs())).toEqual(before);
  });

  it.each(["4.4.1", null])("refuses a concurrent stable update (initial: %s)", (initial) => {
    const f = fixture(initial);
    const concurrent = f.race();
    const before = f.pushed();
    const result = f.run("4.5.0");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stale info");
    expect(f.stable()).toBe(concurrent);
    expect(f.pushed()).toEqual(before);
  });

  it("reads the registry version when the override is unset", () => {
    const f = fixture();
    f.curl("printf '%s\\n' '{\"version\":\"4.5.0\"}'");
    expect(f.run().status).toBe(0);
    expect(f.stable()).toBe(f.commits["4.5.0"]);
  });

  it.each(["exit 22", "printf '{}\\n'", "printf 'invalid json\\n'"])(
    "leaves refs alone and exits successfully on registry failure: %s",
    (body) => {
      const f = fixture();
      const before = f.refs();
      f.curl(body);
      const result = f.run();
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Warning:");
      expect(f.refs()).toBe(before);
      expect(f.pushed()).toEqual([]);
    }
  );
});
