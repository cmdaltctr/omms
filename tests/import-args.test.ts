import { describe, expect, it } from "bun:test";
import { parseImportArgs } from "../src/cli/index.js";
import {
  historyImportUsage,
  importNeedsModel,
  parseHistoryImportArgs,
  webImportTokens,
} from "../src/importer/import-args.js";

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

describe("--skip-skills", () => {
  it("is off by default and parses on every host, in the terminal and in a session", () => {
    for (const host of ["pi", "opencode", "claude-code"] as const) {
      for (const surface of ["cli", "session", "web"] as const) {
        expect(parseHistoryImportArgs([], { host, surface }).skipSkills).toBe(false);
        const args = parseHistoryImportArgs(["--skip-skills"], { host, surface });
        expect(args.errors).toEqual([]);
        expect(args.skipSkills).toBe(true);
      }
    }
    expect(parseHistoryImportArgs(["--skip-skills=yes"], cli).errors).toEqual([
      "--skip-skills takes no value",
    ]);
    expect(parseImportArgs(["import-pi-history", "--skip-skills"]).args.skipSkills).toBe(true);
  });

  it("comes from the page's skipSkills option and shows in the help", () => {
    expect(webImportTokens({ skipSkills: true }, "pi")).toEqual(["--skip-skills"]);
    expect(webImportTokens({ skipSkills: false }, "pi")).toEqual([]);
    for (const surface of ["cli", "session"] as const) {
      expect(historyImportUsage("pi", surface)).toContain("--skip-skills");
    }
  });

  it("needs no model when only skill turns are left", () => {
    const args = parseHistoryImportArgs(["--skip-memories", "--skip-profile"], cli);
    expect(importNeedsModel(args)).toBe(false);
  });
});

describe("history import usage per host and surface (characterisation)", () => {
  const sources = {
    pi: "  --root <dir>              Pi session root (default ~/.pi/agent/sessions)",
    opencode:
      "  --db <path>               OpenCode database (default ~/.local/share/opencode/opencode.db)",
    "claude-code":
      "  --root <dir>              Claude Code transcripts folder (default ~/.claude/projects)",
  } as const;
  const invokes = {
    pi: { session: "/memory-import-pi-history", other: "om-memory-system import-pi-history" },
    opencode: {
      session: "/memory-import-opencode-history",
      other: "om-memory-system import-opencode-history",
    },
    "claude-code": {
      session: "om-memory-system import-claude-history",
      other: "om-memory-system import-claude-history",
    },
  } as const;
  const sessionModel =
    "  --model <provider/id>     Use another signed-in model (default: this session's model)";

  it("names the command, source option, and model options for each host", () => {
    const rest = new Set<string>();
    for (const host of ["pi", "opencode", "claude-code"] as const) {
      for (const surface of ["session", "cli", "web"] as const) {
        const usage = historyImportUsage(host, surface);
        const invoke = surface === "session" ? invokes[host].session : invokes[host].other;
        const lines = usage.split("\n");
        expect(lines[0]).toBe(`Usage: ${invoke} [options]`);
        expect(lines).toContain(`Preview first: ${invoke} --dry-run`);
        expect(lines).toContain(sources[host]);
        expect(lines.includes(sessionModel)).toBe(surface === "session");
        expect(
          lines.includes(
            "  --api-key-env <name>      Read the API key from this environment variable"
          )
        ).toBe(surface !== "session");
        const shared = usage
          .replaceAll(invoke, "<invoke>")
          .replace(sources[host], "<source>")
          .replace(/\n {2}--model[\s\S]*?(?=\n {2}--scope)/, "\n<model>");
        rest.add(shared);
      }
    }
    // Every other line is the same text for every host and surface.
    expect(rest.size).toBe(1);
  });
});

// Characterisation (modular-boundaries): the source flag now comes from the host registry.
describe("history source flag per host", () => {
  const cases = [
    ["pi", "--root", "--db"],
    ["opencode", "--db", "--root"],
    ["claude-code", "--root", "--db"],
  ] as const;
  for (const [host, own, other] of cases) {
    it(`takes ${own} and refuses ${other} for ${host}`, () => {
      for (const surface of ["session", "cli", "web"] as const) {
        const parsed = parseHistoryImportArgs([own, "/s", `${other}=/t`], { host, surface });
        expect(parsed.source).toBe("/s");
        expect(parsed.errors).toEqual([`Unknown option: "${other}=/t"`]);
      }
    });
  }
});
