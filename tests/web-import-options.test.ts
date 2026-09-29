import { expect, it } from "bun:test";
import { parseHistoryImportArgs, webImportTokens } from "../src/importer/import-args.js";

it("parses page options with the same grammar as the equivalent CLI flags", () => {
  const page = {
    dryRun: true,
    scope: "current-project" as const,
    project: "/tmp/project",
    since: 1767225600000,
    until: "2026-01-31",
    pathMaps: [{ from: "/old", to: "/new" }],
    skipMemories: true,
    skipProfile: true,
    profileBatch: 4,
  };
  const pageArgs = parseHistoryImportArgs(webImportTokens(page, "pi"), {
    host: "pi",
    surface: "web",
  });
  const flags = [
    "--dry-run",
    "--scope",
    "current-project",
    "--project",
    "/tmp/project",
    "--since",
    "1767225600000",
    "--until",
    "2026-01-31",
    "--map",
    "/old=/new",
    "--skip-memories",
    "--skip-profile",
    "--profile-batch",
    "4",
  ];
  expect(pageArgs).toEqual(parseHistoryImportArgs(flags, { host: "pi", surface: "cli" }));
  expect(pageArgs.since).toBe(1767225600000);
});

it("never turns page options into session, max-sessions, or source flags", () => {
  const tokens = webImportTokens(
    { session: "s1", maxSessions: 2, source: "/x" } as never,
    "opencode"
  );
  expect(tokens).toEqual([]);
});

it("parses Claude Code page options like its CLI flags, with no model", () => {
  const page = { dryRun: true, scope: "all-projects" as const, since: "2026-01-01" };
  const pageArgs = parseHistoryImportArgs(webImportTokens(page, "claude-code"), {
    host: "claude-code",
    surface: "web",
  });
  expect(pageArgs.errors).toEqual([]);
  expect(pageArgs).toEqual(
    parseHistoryImportArgs(["--dry-run", "--scope", "all-projects", "--since", "2026-01-01"], {
      host: "claude-code",
      surface: "cli",
    })
  );
  expect(pageArgs.model).toBeUndefined();
});
