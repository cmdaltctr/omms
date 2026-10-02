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

  it("marketplace lists the plugin from the repository root", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json");

    expect(typeof marketplace.name).toBe("string");
    expect(typeof marketplace.owner?.name).toBe("string");
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({ name: "omms", source: "./" });
  });

  it("manifest says the global install is optional", () => {
    const { description } = readJson(".claude-plugin/plugin.json");
    expect(description).not.toMatch(/needs om-memory-system installed globally/i);
    expect(description).toMatch(/global install is optional/i);
  });

  it("hooks run the plugin launcher with the agreed timeouts", () => {
    const { hooks } = readJson("hooks/hooks.json");

    expect(Object.keys(hooks).sort()).toEqual(["SessionStart", "Stop", "UserPromptSubmit"]);
    const launch = 'node "${CLAUDE_PLUGIN_ROOT}/bin/omms-launch.mjs" --at-least-own-version';
    const expected: Record<string, { command: string; timeout: number; async?: true }> = {
      SessionStart: { command: `${launch} claude-hook session-start`, timeout: 20 },
      UserPromptSubmit: { command: `${launch} claude-hook user-prompt-submit`, timeout: 10 },
      Stop: { command: `${launch} claude-hook stop`, timeout: 60, async: true },
    };
    for (const [event, handler] of Object.entries(expected)) {
      expect(hooks[event]).toHaveLength(1);
      expect(hooks[event][0].hooks).toEqual([{ type: "command", ...handler }]);
    }
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
});
