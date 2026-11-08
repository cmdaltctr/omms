import { expect, it, setDefaultTimeout } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startStandaloneWeb, takePort } from "./standalone-web-fixture.js";

// A package folder with a launcher, so the login item can be installed.
const repoRoot = join(import.meta.dir, "..");

setDefaultTimeout(60_000);

it("web install hands the port over from a real older standalone web app", async () => {
  const old = await startStandaloneWeb("0.0.1");
  let newOwner: ReturnType<typeof Bun.serve> | undefined;
  try {
    const script = join(old.home, "install.mjs");
    const commandUrl = new URL("../src/cli/web-command.js", import.meta.url).href;
    writeFileSync(
      script,
      `
const { runWebCommand } = await import(${JSON.stringify(commandUrl)});
const options = { home: ${JSON.stringify(old.home)}, platform: "darwin", runtime: "/opt/node",
  packageRoot: ${JSON.stringify(repoRoot)}, run: () => {} }; // The login item start is stubbed.
const code = await runWebCommand(["install"], options, async () => false,
  { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, 50)) });
console.log("RESULT:" + JSON.stringify({ code }));
process.exit(0);
`
    );
    const install = Bun.spawn(["bun", "run", script], {
      cwd: old.home,
      env: {
        ...process.env,
        HOME: old.home,
        USERPROFILE: old.home,
        OMMS_LOG_FILE: join(old.home, "install.log"),
        OMMS_DISABLE_WEB_AUTOSTART: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(install.stdout).text();
    await install.exited;
    const stderr = await new Response(install.stderr).text();
    const match = text.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${text}\n${stderr}`);
    expect(JSON.parse(match[1]!).code).toBe(0);

    // The login item start is stubbed, so a stand-in takes the port; the old app then exits.
    newOwner = await takePort(old.port);
    expect(await old.child.exited).toBe(0);
    expect(text).toContain("OMMS login item: installed");
  } finally {
    newOwner?.stop(true);
    old.child.kill("SIGKILL");
    await old.child.exited;
    rmSync(old.home, { recursive: true, force: true });
    rmSync(old.root, { recursive: true, force: true });
  }
});
