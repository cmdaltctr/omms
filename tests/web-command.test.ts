import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("manages a temp login item and saves the matching global switch", () => {
  const home = mkdtempSync(join(tmpdir(), "omms-web-command-"));
  try {
    const script = join(home, "scenario.mjs");
    const commandUrl = new URL("../src/cli/web-command.js", import.meta.url).href;
    writeFileSync(
      script,
      `
const { readFileSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { runWebCommand } = await import(${JSON.stringify(commandUrl)});
const home = ${JSON.stringify(home)};
const commands = [];
const options = { home, platform: "darwin", runtime: "/opt/node",
  packageRoot: "/opt/omms", run: (command, args) => commands.push([command, ...args].join(" ")) };
const install = await runWebCommand(["install"], options, async () => false);
const path = join(home, ".config", "omms", "omms.jsonc");
const installedConfig = readFileSync(path, "utf8");
const status = await runWebCommand(["status"], options, async () => false);
const uninstall = await runWebCommand(["uninstall"], options, async () => false);
const uninstalledConfig = readFileSync(path, "utf8");
writeFileSync(path, '{ "webServerEnabled": false }');
const refused = await runWebCommand([], options, async () => false);
const disabledInstall = await runWebCommand(["install"], options, async () => false);
const disabledConfig = readFileSync(path, "utf8");
console.log("RESULT:" + JSON.stringify({ install, status, uninstall, refused, disabledInstall,
  disabledConfig, installedConfig, uninstalledConfig, commands }));
`
    );
    const child = Bun.spawnSync(["bun", "run", script], {
      cwd: home,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    const text = child.stdout.toString();
    const match = text.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${text}\n${child.stderr.toString()}`);
    const out = JSON.parse(match[1]);
    expect([out.install, out.status, out.uninstall, out.refused, out.disabledInstall]).toEqual([
      0, 0, 0, 1, 1,
    ]);
    expect(out.disabledConfig).toBe('{ "webServerEnabled": false }');
    expect(out.installedConfig).toContain('"webServerAutoStart": true');
    expect(out.uninstalledConfig).toContain('"webServerAutoStart": false');
    expect(out.commands.some((line: string) => line.includes("launchctl bootstrap"))).toBe(true);
    expect(text).toContain("OMMS web app: http://127.0.0.1:4747");
    expect(text).toContain('"url": "http://127.0.0.1:4747"');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
