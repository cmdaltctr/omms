import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address !== "string"
          ? resolve(address.port)
          : reject(new Error("no port"))
      );
    });
  });
}

/**
 * Start a standalone `web` command from the current build on a spare port.
 * With `version`, it runs from a copy of the build that reports that version.
 */
export async function startStandaloneWeb(version?: string) {
  const home = mkdtempSync(join(tmpdir(), "omms-standalone-step-aside-"));
  const port = await freePort();
  const token = "test-token-for-step-aside";
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  mkdirSync(join(home, ".omms"), { recursive: true });
  writeFileSync(join(home, ".omms", ".auth-token"), token, { mode: 0o600 });
  writeFileSync(
    join(home, ".config", "omms", "omms.jsonc"),
    JSON.stringify({
      storagePath: join(home, "data"),
      webServerEnabled: true,
      webServerAutoStart: false,
      webServerPort: port,
      webServerHost: "127.0.0.1",
    })
  );
  let root = repoRoot;
  if (version) {
    root = mkdtempSync(join(tmpdir(), "omms-old-build-"));
    cpSync(join(repoRoot, "dist"), join(root, "dist"), { recursive: true });
    symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"));
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ ...pkg, version }));
  }
  const child = Bun.spawn(["node", "dist/cli/index.js", "web"], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_LOG_FILE: join(home, "omms.log"),
      OMMS_DISABLE_AUTO_BACKFILL: "1",
      OMMS_DISABLE_WEB_AUTOSTART: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {
      /* Not listening yet. */
    }
    if (Date.now() > deadline) throw new Error("standalone web app did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { home, port, token, child, root };
}
