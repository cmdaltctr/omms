import { homedir } from "node:os";
import type { WebAutostartOptions } from "../services/web-autostart.js";

/** Run the standalone web app or manage its per-user login item. */
export async function runWebCommand(
  args: string[],
  options: WebAutostartOptions = {},
  online?: () => Promise<boolean>
): Promise<number> {
  const home = options.home ?? homedir();
  const config = await import("../config.js");
  config.initConfig(home);
  const { installWebAutostart, removeWebAutostart, webAutostartStatus } =
    await import("../services/web-autostart.js");
  const [action, ...rest] = args;
  if (
    rest.length ||
    (action && !["install", "uninstall", "status", "--login-item"].includes(action))
  ) {
    console.error("Usage: om-memory-system web [install|uninstall|status]");
    return 1;
  }
  if (action === "install" && !config.CONFIG.webServerEnabled) {
    console.error("OMMS web server is disabled (webServerEnabled is false)");
    return 1;
  }
  if (action === "install" || action === "uninstall") {
    const { readGlobalConfigRevision, writeGlobalConfigKeys } =
      await import("../services/global-config-writer.js");
    await writeGlobalConfigKeys(
      { webServerAutoStart: action === "install" },
      readGlobalConfigRevision()
    );
    config.initConfig(home);
    const result =
      action === "install"
        ? installWebAutostart({ ...options, start: true })
        : removeWebAutostart({ ...options, start: true });
    console.log(`OMMS login item: ${result.state}`);
    return action === "install" && result.state !== "installed" ? 1 : 0;
  }
  if (action === "status") {
    const status = webAutostartStatus(options);
    const check =
      online ??
      (async () => {
        const { WebServer } = await import("../services/web-server.js");
        return new WebServer({
          port: config.CONFIG.webServerPort,
          host: config.CONFIG.webServerHost,
          enabled: true,
          apiToken: config.CONFIG.webServerApiToken,
        }).checkServerAvailable();
      });
    console.log(
      JSON.stringify(
        { setting: config.CONFIG.webServerAutoStart, item: status, online: await check() },
        null,
        2
      )
    );
    return 0;
  }
  if (!config.CONFIG.webServerEnabled) {
    console.error("OMMS web server is disabled (webServerEnabled is false)");
    return 1;
  }
  const { WebAuth } = await import("../services/web-auth.js");
  const { startWebServer } = await import("../services/web-server.js");
  const server = await startWebServer({
    directory: home,
    port: config.CONFIG.webServerPort,
    host: config.CONFIG.webServerHost,
    enabled: true,
    apiToken: config.CONFIG.webServerApiToken,
    auth: new WebAuth({
      password: config.CONFIG.webServerAuthPassword,
      username: config.CONFIG.webServerAuthUsername,
    }),
  });
  console.log(`OMMS web app: ${server.getUrl()}`);
  // The Node HTTP adapter unrefs its socket for plugin use. Keep the CLI alive.
  const keeper = setInterval(() => {}, 60_000);
  const stop = () => {
    clearInterval(keeper);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    void server.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return 0;
}
