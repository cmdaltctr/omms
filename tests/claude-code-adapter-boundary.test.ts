import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOST_SDK_SPECIFIER as hostSdkSpecifier,
  crossings,
  localImports,
  srcRoot,
  tsFiles,
} from "./source-imports.js";

// Areas are `src/`-relative folders or files.
const claudeCodeAdapter = ["adapters/claude-code"];
const openCodeHost = ["adapters/opencode", "v2", "plugin.ts"];
const piHost = ["adapters/pi"];
const sharedLayers = ["core", "services", "importer", "types"];

describe("Claude Code adapter boundary", () => {
  it("resolves the CLI's lazy import of the hook command", () => {
    // Guards the scanner itself: a scan that finds nothing would pass every check below.
    expect(localImports("cli/index.ts")).toContain("adapters/claude-code/hook-command.ts");
  });

  it("keeps the OpenCode and Pi hosts out of the Claude Code adapter", () => {
    expect(crossings(claudeCodeAdapter, [...openCodeHost, ...piHost])).toEqual([]);
  });

  it("keeps host SDKs out of the Claude Code adapter", () => {
    const offenders = tsFiles("adapters/claude-code").filter((file) =>
      hostSdkSpecifier.test(readFileSync(join(srcRoot, file), "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the Claude Code adapter out of the shared core, services, importer, and types", () => {
    expect(crossings(sharedLayers, claudeCodeAdapter)).toEqual([]);
  });

  it("keeps the Claude Code adapter out of the OpenCode and Pi hosts", () => {
    expect(crossings([...openCodeHost, ...piHost], claudeCodeAdapter)).toEqual([]);
  });
});
