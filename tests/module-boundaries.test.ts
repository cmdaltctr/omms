import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HOST_SDK_SPECIFIER, crossings, localImports, srcRoot, tsFiles } from "./source-imports.js";

// Shared layers that must not name any host SDK.
const sharedAreas = ["core", "services", "types", "utils", "shared", "config.ts"];
// The importer keeps its Pi reader exception (pi-adapter-boundary), so only the OpenCode SDK is checked there.
const openCodeSdkSpecifier = /["'`]@opencode\//;
// The OpenCode host is its adapter folder plus the V2 plugin entry points.
const openCodeEntryAreas = ["v2", "plugin.ts"];

/** Reads each host folder under `src/adapters/` at run time, so a new host is checked too. */
function hostAreas(): Map<string, string[]> {
  const hosts = readdirSync(join(srcRoot, "adapters"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return new Map(
    hosts.map((host) => [
      host,
      host === "opencode" ? [`adapters/${host}`, ...openCodeEntryAreas] : [`adapters/${host}`],
    ])
  );
}

function filesNaming(areas: string[], pattern: RegExp): string[] {
  return areas
    .flatMap(tsFiles)
    .filter((file) => pattern.test(readFileSync(join(srcRoot, file), "utf8")))
    .map((file) => `src/${file}`);
}

describe("module boundaries", () => {
  it("resolves the CLI's lazy import of the hook command", () => {
    // Guards the scanner itself: a scan that finds nothing would pass every check below.
    expect(localImports("cli/index.ts")).toContain("adapters/claude-code/hook-command.ts");
  });

  it("keeps host SDKs out of the shared layers", () => {
    expect(filesNaming(sharedAreas, HOST_SDK_SPECIFIER)).toEqual([]);
  });

  it("keeps the OpenCode SDK out of the importer", () => {
    expect(filesNaming(["importer"], openCodeSdkSpecifier)).toEqual([]);
  });

  it("keeps each host adapter out of every other host adapter", () => {
    const hosts = hostAreas();
    expect([...hosts.keys()]).toEqual(expect.arrayContaining(["claude-code", "opencode", "pi"]));
    const offenders: string[] = [];
    for (const [host, areas] of hosts) {
      for (const [other, otherAreas] of hosts) {
        if (other !== host) offenders.push(...crossings(areas, otherAreas));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lets only the OpenCode host import the V2 plugin and src/plugin.ts", () => {
    const openCodeHost = hostAreas().get("opencode")!;
    const outside = tsFiles(".").filter(
      (file) => !openCodeHost.some((area) => file === area || file.startsWith(`${area}/`))
    );
    expect(crossings(outside, openCodeEntryAreas)).toEqual([]);
  });

  it("keeps host adapters and entry points out of src/utils/ and src/config.ts", () => {
    // Guards the scan: an empty utils folder would pass the check below.
    expect(tsFiles("utils")).toContain("utils/backfill-model.ts");
    expect(crossings(["utils", "config.ts"], ["adapters", "v2", "plugin.ts"])).toEqual([]);
  });

  it("keeps src/shared/ a leaf that imports only itself and packages", () => {
    const offenders = tsFiles("shared").flatMap((file) =>
      localImports(file)
        .filter((target) => !target.startsWith("shared/"))
        .map((target) => `src/${file} -> src/${target}`)
    );
    expect(offenders).toEqual([]);
  });
});
