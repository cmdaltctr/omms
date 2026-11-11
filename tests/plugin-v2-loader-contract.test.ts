import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

function readPackageJson(): Record<string, any> {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<
    string,
    any
  >;
}

describe("OpenCode v2 plugin-loader contract", () => {
  it("publishes the native v2 entrypoint", () => {
    const pkg = readPackageJson();
    expect(pkg.exports?.["./v2"]).toEqual({
      types: "./dist/v2/plugin.d.ts",
      import: "./dist/v2/plugin.js",
      default: "./dist/v2/plugin.js",
    });
    expect(pkg.files).toContain("dist");
  });

  it("exports a native v2 plugin definition", async () => {
    const mod = await import(new URL("../dist/v2/plugin.js", import.meta.url).href);
    expect(mod.default.id).toBe("omms");
    expect(typeof mod.default.setup).toBe("function");
  });

  it("exposes only V2 from the installable package entrypoint", async () => {
    const mod = await import(new URL("../dist/plugin.js", import.meta.url).href);
    expect(mod.default.id).toBe("omms");
    expect("server" in mod.default).toBe(false);
    expect(typeof mod.default.setup).toBe("function");
  });

  it("publishes the TUI entry that draws recall rows", async () => {
    const pkg = readPackageJson();
    // OpenCode compiles this source file itself; it imports the recall module from dist/.
    expect(pkg.exports?.["./tui"]).toBe("./opencode/tui.tsx");
    expect(pkg.files).toContain("opencode");
    const tui = await import(
      new URL("../dist/adapters/opencode/tui-recall.js", import.meta.url).href
    );
    expect(typeof tui.startTuiRecall).toBe("function");
  });

  it("publishes the recall RPC contract the server and the TUI share", async () => {
    const mod = await import(new URL("../dist/v2/recall-rpc.js", import.meta.url).href);
    expect(mod.recallRpc.id).toBe("omms-recall");
    expect(Object.keys(mod.recallRpc.methods)).toEqual(["list"]);
    expect(Object.keys(mod.recallRpc.events)).toEqual(["recalled"]);
  });
});
