import { describe, expect, it } from "bun:test";
import { parseImportArgs } from "../src/cli/index.js";
import { historyImportUsage, parseHistoryImportArgs } from "../src/importer/import-args.js";

const cli = { host: "claude-code" as const, surface: "cli" as const };

describe("Claude Code history import arguments", () => {
  it("parses the shared flags", () => {
    const args = parseHistoryImportArgs(
      ["--dry-run", "--scope", "all-projects", "--since", "2026-01-01", "--skip-memories"],
      cli
    );
    expect(args.errors).toEqual([]);
    expect(args).toMatchObject({
      dryRun: true,
      scope: "all-projects",
      since: Date.parse("2026-01-01"),
      skipMemories: true,
      skipProfile: false,
    });
  });

  it("takes the transcripts folder from --root", () => {
    expect(parseHistoryImportArgs(["--root", "/data/claude"], cli).source).toBe("/data/claude");
    expect(parseHistoryImportArgs(["--root=/data/claude"], cli).source).toBe("/data/claude");
  });

  it("rejects --db, which names an OpenCode database", () => {
    expect(parseHistoryImportArgs(["--db=/x/opencode.db"], cli).errors).toEqual([
      'Unknown option: "--db=/x/opencode.db"',
    ]);
    expect(parseHistoryImportArgs(["--db", "/x/opencode.db"], cli).errors).toContain(
      'Unknown option: "--db"'
    );
  });

  it("accepts the CLI-only model flags only in the terminal", () => {
    const flags = ["--provider", "openai-chat", "--api-url", "https://x", "--api-key-env", "KEY"];
    const terminal = parseHistoryImportArgs(flags, cli);
    expect(terminal.errors).toEqual([]);
    expect(terminal).toMatchObject({
      provider: "openai-chat",
      apiUrl: "https://x",
      apiKeyEnv: "KEY",
    });
    const web = parseHistoryImportArgs(flags, { host: "claude-code", surface: "web" });
    for (const flag of ["--provider", "--api-url", "--api-key-env"]) {
      expect(web.errors).toContain(
        `${flag} is only for the om-memory-system CLI; use --model provider/id`
      );
    }
  });

  it("maps the import-claude-history command to the claude-code host", () => {
    const { host, args } = parseImportArgs(["import-claude-history", "--dry-run", "--root", "/r"]);
    expect(host).toBe("claude-code");
    expect(args).toMatchObject({ dryRun: true, source: "/r" });
    expect(() => parseImportArgs(["import-claude-history", "--db", "/x.db"])).toThrow("--db");
    expect(() => parseImportArgs(["import-codex-history"])).toThrow("import-claude-history");
  });

  it("prints the terminal command, --root, and the external API flags in its help", () => {
    for (const surface of ["cli", "session"] as const) {
      const usage = historyImportUsage("claude-code", surface);
      expect(usage).toContain("om-memory-system import-claude-history");
      expect(usage).toContain("--root <dir>");
      expect(usage).toContain("~/.claude/projects");
      expect(usage).not.toContain("--db");
    }
    expect(historyImportUsage("claude-code", "cli")).toContain("--api-key-env");
  });
});
