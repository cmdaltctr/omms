// Decides whether a pull request is an untouched release-please pull request
// that Release auto-merge may merge. A branch name proves nothing: anyone with
// write access can create one. Only commits that the release App made through
// the GitHub API carry its author and a GitHub signature.
// Usage: node scripts/release-pr-guard.mjs <folder> <bot-login> <tested-sha>
// The folder holds pr.json, commits.json, files.json, and base/ and head/
// copies of the version files.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION_FILES = [
  ".release-please-manifest.json",
  "package.json",
  ".claude-plugin/plugin.json",
];
const ALLOWED_FILES = new Set([...VERSION_FILES, "CHANGELOG.md"]);
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Returns the reasons not to merge; an empty list means merge. */
export function releasePrProblems({ pr, commits, files, contents, bot, testedSha }) {
  const problems = [];
  if (pr.user?.login !== bot || pr.user?.type !== "Bot") {
    problems.push(`author is ${pr.user?.login}, not ${bot}`);
  }
  if (pr.head?.repo?.full_name !== pr.base?.repo?.full_name) problems.push("head is a fork");
  if (pr.base?.ref !== "main") problems.push(`base is ${pr.base?.ref}, not main`);
  if (pr.head?.sha !== testedSha) problems.push("head moved after the tested commit");
  if (commits.length === 0 || commits.length >= 100) problems.push("unexpected commit count");
  for (const commit of commits) {
    const id = String(commit.sha).slice(0, 7);
    if (commit.author?.login !== bot) problems.push(`commit ${id} author is not ${bot}`);
    if (commit.committer?.login !== "web-flow" || commit.commit?.verification?.verified !== true) {
      problems.push(`commit ${id} is not signed by GitHub`);
    }
  }
  for (const file of files) {
    if (!ALLOWED_FILES.has(file.filename)) problems.push(`unexpected file ${file.filename}`);
    else if (file.status !== "modified") problems.push(`${file.filename} is ${file.status}`);
    if (file.filename === "CHANGELOG.md" && file.deletions !== 0) {
      problems.push("CHANGELOG.md removes lines");
    }
  }
  const versions = new Set();
  for (const name of VERSION_FILES) {
    if (!files.some((file) => file.filename === name)) continue;
    try {
      const base = JSON.parse(contents.base[name]);
      const head = JSON.parse(contents.head[name]);
      const headVersions = name === VERSION_FILES[0] ? Object.values(head) : [head.version];
      for (const key of name === VERSION_FILES[0] ? Object.keys(base) : ["version"]) {
        delete base[key];
        delete head[key];
      }
      if (JSON.stringify(base) !== JSON.stringify(head))
        problems.push(`${name} changes more than the version`);
      for (const version of headVersions) {
        if (!SEMVER.test(String(version))) problems.push(`${name} has version ${version}`);
        versions.add(version);
      }
    } catch {
      problems.push(`${name} cannot be read`);
    }
  }
  if (versions.size !== 1) problems.push("version files disagree");
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [folder, bot, testedSha] = process.argv.slice(2);
  const read = (path) => readFileSync(join(folder, path), "utf8");
  const contents = { base: {}, head: {} };
  for (const side of ["base", "head"]) {
    for (const name of VERSION_FILES) {
      try {
        contents[side][name] = read(join(side, name));
      } catch {
        // Missing copies are reported as unreadable when the file changed.
      }
    }
  }
  const problems = releasePrProblems({
    pr: JSON.parse(read("pr.json")),
    commits: JSON.parse(read("commits.json")),
    files: JSON.parse(read("files.json")),
    contents,
    bot,
    testedSha,
  });
  for (const problem of problems) console.error(`Not merged: ${problem}`);
  process.exit(problems.length === 0 ? 0 : 1);
}
