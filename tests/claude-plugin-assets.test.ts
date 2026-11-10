import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Claude Code plugin is a manifest, a marketplace file, the hook file, the
 * launcher the hooks run, and one skill. Every hook runs the launcher, which
 * runs the newest local OMMS copy or `npx` at the plugin's version, so a global
 * install is optional. No MCP server exists.
 */

const root = join(import.meta.dir, "..");
const readJson = (path: string): any => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("Claude Code plugin assets", () => {
  it("manifest names the plugin, matches the package version, and has no MCP servers", () => {
    const manifest = readJson(".claude-plugin/plugin.json");
    const pkg = readJson("package.json");

    expect(manifest.name).toBe("omms");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.license).toBe(pkg.license);
    expect(typeof manifest.description).toBe("string");
    expect(typeof manifest.author?.name).toBe("string");
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
  });

  it("marketplace installs the stable channel through an explicit HTTPS Git URL", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json");

    expect(typeof marketplace.name).toBe("string");
    expect(typeof marketplace.owner?.name).toBe("string");
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({ name: "omms" });
    expect(marketplace.plugins[0].source).toEqual({
      source: "url",
      url: "https://github.com/cmdaltctr/omms.git",
      ref: "stable",
    });
  });

  it("manifest says the global install is optional", () => {
    const { description } = readJson(".claude-plugin/plugin.json");
    expect(description).not.toMatch(/needs om-memory-system installed globally/i);
    expect(description).toMatch(/global install is optional/i);
  });

  it("hooks run the plugin launcher with the agreed timeouts", () => {
    const { hooks } = readJson("hooks/hooks.json");

    // SubagentStart registers; SubagentStop must not, because subagent turns are not captured.
    expect(Object.keys(hooks).sort()).toEqual([
      "SessionStart",
      "Stop",
      "SubagentStart",
      "UserPromptSubmit",
    ]);
    const launch = 'node "${CLAUDE_PLUGIN_ROOT}/bin/omms-launch.mjs" --at-least-own-version';
    const expected: Record<string, { command: string; timeout: number; async?: true }> = {
      SessionStart: { command: `${launch} claude-hook session-start`, timeout: 20 },
      UserPromptSubmit: { command: `${launch} claude-hook user-prompt-submit`, timeout: 10 },
      SubagentStart: { command: `${launch} claude-hook subagent-start`, timeout: 10 },
      Stop: { command: `${launch} claude-hook stop`, timeout: 60, async: true },
    };
    for (const [event, handler] of Object.entries(expected)) {
      expect(hooks[event]).toHaveLength(1);
      expect(hooks[event][0].hooks).toEqual([{ type: "command", ...handler }]);
    }
  });

  it("describes the hooks without saying memories are injected at session start", () => {
    const { description } = readJson("hooks/hooks.json");
    expect(description).not.toMatch(/session start/i);
    expect(description).toMatch(/prompt/i);
  });

  it("loads one module entry beside the launcher hooks, and every file it imports exists", () => {
    const { modules } = readJson("hooks/hooks.json");
    expect(modules).toEqual(["./omms.jsx"]);

    // Claude Code loads the files the entry imports with it, so a missing one
    // breaks the status label, the tool and the recall rows together.
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      expect(existsSync(join(root, "hooks", file))).toBe(true);
      const text = readFileSync(join(root, "hooks", file), "utf8");
      for (const [, path] of text.matchAll(/from\s+["']\.\/([^"']+)["']/g)) visit(path!);
    };
    visit("omms.jsx");
    expect(seen.has("omms-status.jsx")).toBe(true);
  });

  it("ships the launcher the hooks run, with no version number in the hook file", () => {
    expect(existsSync(join(root, "bin", "omms-launch.mjs"))).toBe(true);
    const text = readFileSync(join(root, "hooks/hooks.json"), "utf8");
    expect(text).not.toMatch(/\d+\.\d+\.\d+/);
    expect(text).not.toContain("npx");
  });

  it("skill has name and description frontmatter and names the memory command", () => {
    const skill = readFileSync(join(root, "skills/omms-memory/SKILL.md"), "utf8");
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1];

    expect(frontmatter).toBeDefined();
    expect(frontmatter).toMatch(/^name: omms-memory$/m);
    expect(frontmatter).toMatch(/^description: \S.+$/m);
    expect(skill).toContain('om-memory-system memory search "<query>"');
    expect(skill).toContain("om-memory-system memory add --content");
    expect(skill).toContain("<private>");
  });

  it("skill serves every host: tool when present, command otherwise, with its triggers", () => {
    const skill = readFileSync(join(root, "skills/omms-memory/SKILL.md"), "utf8");
    const description = skill.match(/^description: (.+)$/m)?.[1] ?? "";
    for (const trigger of [
      "debug",
      "investigat",
      "we fixed this before",
      "last time",
      "remember",
      "did we",
      "convention",
    ]) {
      expect(description.toLowerCase()).toContain(trigger);
    }
    expect(skill).toContain("`memory` tool");
    expect(skill).toContain('mode: "search"');
    expect(skill).toContain("om-memory-system memory search");
    expect(skill).toMatch(/all-projects/);
    expect(skill).toMatch(/Never store secrets/);
  });

  it("omms-remember saves a context snapshot and tells the user how to recall it", () => {
    const skill = readFileSync(join(root, "skills/omms-remember/SKILL.md"), "utf8");
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1];

    expect(frontmatter).toMatch(/^name: omms-remember$/m);
    expect(frontmatter).toMatch(/^description: \S.+$/m);
    expect(skill).toContain('mode: "memorise"');
    for (const field of ["topic", "done", "doing", "next"]) {
      expect(skill).toContain(`${field}:`);
    }
    expect(skill).toContain("`mcp__omms__memory`");
    expect(skill).toContain("om-memory-system memory memorise");
    expect(skill).toMatch(/branch/i);
    expect(skill).toMatch(/head/i);
    expect(skill).toMatch(/read-only/i);
    expect(skill).toMatch(/history|transcript/i);
    expect(skill).toMatch(/size cap/i);
    expect(skill).toMatch(/Never store secrets/);
    expect(skill).toContain('mode: "recall"');
    expect(skill).toContain("/omms:omms-remember");
    expect(skill).toContain("/skill:omms-remember");
    expect(skill).toContain("/omms-remember");
  });

  it("omms-remember passes every label the user names in tags and recalls by label", () => {
    const skill = readFileSync(join(root, "skills/omms-remember/SKILL.md"), "utf8");
    // The save example carries a tags field, and the rule says to keep every user label.
    expect(skill).toMatch(/tags: "<[^"]*label/i);
    expect(skill).toMatch(/every label the user names/i);
    expect(skill).toMatch(/exactly as (the user )?written/i);
    expect(skill).toMatch(/never drop/i);
    expect(skill).toMatch(/1 to 3 (labels|tags)/i);
    expect(skill).toContain("--tags");
    // Recall by label uses recall with tags.
    expect(skill).toMatch(/mode: "recall", tags: "<label/);
    expect(skill).toContain("om-memory-system memory recall --tags");
  });

  it("omms-memory routes 'the memorisation labelled X' to recall with tags", () => {
    const skill = readFileSync(join(root, "skills/omms-memory/SKILL.md"), "utf8");
    expect(skill).toMatch(/the memorisation labelled/);
    expect(skill).toMatch(/mode: "recall", tags:/);
    const modes = skill.match(/## Modes\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
    expect(modes).toMatch(/`recall`[^\n]*tags/);
    expect(modes).toMatch(/`memorise`[^\n]*tags/);
  });

  it("skill names the Claude Code tool in How to call OMMS", () => {
    const skill = readFileSync(join(root, "skills/omms-memory/SKILL.md"), "utf8");
    const howTo = skill.match(/## How to call OMMS\n([\s\S]*?)\n## /)?.[1] ?? "";
    expect(howTo).toContain("`mcp__omms__memory`");
    expect(howTo).toContain("om-memory-system memory");
  });

  it("omms-memory routes planned-work questions and IDs to recall", () => {
    const skill = readFileSync(join(root, "skills/omms-memory/SKILL.md"), "utf8");
    const modes = skill.match(/## Modes\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";

    expect(skill).toContain("what were we gonna do with");
    expect(skill).toContain("what did I memorise");
    expect(skill).toContain('mode: "recall"');
    expect(modes).toMatch(/`memorise`/);
    expect(modes).toMatch(/`recall`/);
  });

  it("skill has a short Using OMMS in Claude Code section", () => {
    const skill = readFileSync(join(root, "skills/omms-memory/SKILL.md"), "utf8");
    expect(skill.match(/^## Using OMMS in Claude Code$/gm)).toHaveLength(1);
    const section = skill.match(/## Using OMMS in Claude Code\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
    expect(section).toContain("`mcp__omms__memory`");
    expect(section).toContain("▸ ● memory [mode=");
    for (const mode of ["import", "export", "migrate", "list-shards"]) {
      expect(section).toContain(`\`${mode}\``);
    }
    expect(section).toContain("om-memory-system memory");
    expect(section).toContain("`forget`");
    expect(section).toMatch(/\bid\b/);
    expect(section).toMatch(/capture runs/i);
    expect(section).toMatch(/twice|again/);
    expect(section).not.toMatch(/\b(Pi|OpenCode)\b/);
  });
});
