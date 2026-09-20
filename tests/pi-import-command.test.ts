import { describe, expect, it } from "bun:test";
import {
  PI_IMPORT_COMMAND,
  PI_IMPORT_USAGE,
  parseImportArgs,
} from "../src/adapters/pi/import-command.js";

describe("import command argument parsing", () => {
  it("defaults to current-project scope with no writes", () => {
    const parsed = parseImportArgs("");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.force).toBe(false);
    expect(parsed.scope).toBe("current-project");
    expect(parsed.pathMaps).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("parses flags, dates, and numeric limits", () => {
    const parsed = parseImportArgs(
      "--dry-run --force --scope=all-projects --session=sess-1 --since=2026-01-01 --until=2026-03-01T00:00:00Z --max-sessions=5"
    );
    expect(parsed.dryRun).toBe(true);
    expect(parsed.force).toBe(true);
    expect(parsed.scope).toBe("all-projects");
    expect(parsed.session).toBe("sess-1");
    expect(parsed.since).toBe(Date.parse("2026-01-01"));
    expect(parsed.until).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(parsed.maxSessions).toBe(5);
    expect(parsed.errors).toEqual([]);
  });

  it("accepts epoch milliseconds and repeated maps", () => {
    const parsed = parseImportArgs(
      "--since=1767225600000 --map=/old/one=/new/one --map=/old/two=/new/two --root=/tmp/sessions"
    );
    expect(parsed.since).toBe(1767225600000);
    expect(parsed.pathMaps).toEqual([
      { from: "/old/one", to: "/new/one" },
      { from: "/old/two", to: "/new/two" },
    ]);
    expect(parsed.root).toBe("/tmp/sessions");
  });

  it("reports invalid values instead of guessing", () => {
    const parsed = parseImportArgs(
      "--scope=nonsense --since=not-a-date --max-sessions=-3 --map=noseparator --unknown"
    );
    expect(parsed.errors.length).toBe(5);
    expect(parsed.errors.join(" ")).toContain("--scope");
    expect(parsed.errors.join(" ")).toContain("--since");
    expect(parsed.errors.join(" ")).toContain("--max-sessions");
    expect(parsed.errors.join(" ")).toContain("--map");
    expect(parsed.errors.join(" ")).toContain("--unknown");
  });

  it("exposes a usage document naming the command", () => {
    expect(PI_IMPORT_COMMAND).toBe("memory-import-pi-history");
    expect(PI_IMPORT_USAGE).toContain(`/${PI_IMPORT_COMMAND}`);
    expect(PI_IMPORT_USAGE).toContain("--dry-run");
    expect(PI_IMPORT_USAGE).toContain("--map=<oldPath>=<newPath>");
  });
});
