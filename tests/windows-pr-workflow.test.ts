import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("the Windows PR check workflow (ADR-037)", () => {
  const workflow = read(".github", "workflows", "windows-pr.yml");

  it("is its own workflow, so a stalled Windows runner cannot fail a Quality run", () => {
    expect(workflow).toMatch(/^name: Windows PR check$/m);
    expect(workflow).not.toMatch(/^name: Quality$/m);
    // Release auto-merge waits for a completed Quality run, and this check must not gate it.
    expect(read(".github", "workflows", "release-auto-merge.yml")).toContain(
      "workflows: [Quality]"
    );
  });

  it("runs on pull requests and skips docs-only changes", () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {4}paths-ignore:/m);
    expect(workflow).toContain("- 'docs/**'");
    expect(workflow).toContain("- '**.md'");
  });

  it("runs the suite on Windows in Git Bash and retries a failed file once", () => {
    expect(workflow).toContain("test-windows-pr:");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("shell: bash");
    expect(workflow).toContain("OMMS_TEST_RETRY: '1'");
    expect(workflow).toContain("run: bash scripts/run-tests-isolated.sh");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("timeout-minutes: 30");
  });

  it("is not a required check", () => {
    const ci = read("docs", "ci.md");
    expect(ci).toContain('Do not add it to the "Protect main" ruleset');
    expect(workflow).not.toMatch(/^\s*required:/m);
  });
});
