import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const repoRoot = join(import.meta.dir, "..");

/**
 * Bundles a dist entry with the `bun build` CLI in a child process.
 *
 * Bun 1.3.14's in-process Bun.build resolves the relative imports of
 * dist/index.js against the importing test file's directory when the test
 * file lives under tests/, so every ./services/*.js import fails to resolve.
 * The CLI build in a fresh process resolves correctly from any location.
 * Revisit once Bun fixes in-process bundler resolution.
 */
function buildDistEntry(entry: string): { dir: string; path: string; text: string } {
  const dir = mkdtempSync(join(tmpdir(), "omms-bundle-boundary-"));
  tempDirs.push(dir);
  const proc = Bun.spawnSync(["bun", "build", entry, "--target=bun", "--outdir", dir], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(
      `bun build failed for ${entry}: ${proc.stderr.toString()}\n${proc.stdout.toString()}`
    );
  }
  const base = entry.split("/").pop()!.replace(/\.js$/, ".js");
  const path = join(dir, base);
  return { dir, path, text: readFileSync(path, "utf8") };
}

describe("OpenCode plugin loader bundle boundary", () => {
  it("does not pull local embedding transformer internals into the plugin-loader bundle", () => {
    const { text } = buildDistEntry("./dist/plugin.js");

    expect(text).not.toContain("node_modules/@huggingface/transformers");
    expect(text).not.toContain("@huggingface/transformers/src");
    expect(text).not.toContain("@huggingface/transformers/dist");
    // Guard against the old backend silently coming back too.
    expect(text).not.toContain("node_modules/@xenova/transformers");
  }, 30_000);

  it("does not pull opencode SDK or OIDC internals into the plugin-loader bundle", () => {
    const { text } = buildDistEntry("./dist/plugin.js");

    expect(text).not.toContain("@opencode-ai/sdk/v2/client");
    expect(text).not.toContain("node_modules/@opencode-ai/sdk");
    expect(text).not.toContain("@vercel/oidc");
    expect(text).not.toContain("getVercelOidcToken");
  }, 30_000);

  it("resolves the provider module from a single-file bundled lazy loader", async () => {
    const { path, text } = buildDistEntry("./dist/services/ai/opencode-provider-loader.js");

    expect(text).not.toContain("@opencode-ai/sdk/v2/client");
    expect(text).not.toContain("@vercel/oidc");

    const mod = await import(`${pathToFileURL(path).href}?cachebust=${Date.now()}`);
    const provider = await mod.loadOpencodeProvider();

    expect(typeof provider.generateStructuredOutput).toBe("function");
    expect(typeof provider.createV2Client).toBe("function");
  }, 30_000);
});
