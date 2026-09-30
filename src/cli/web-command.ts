import { homedir } from "node:os";
import type { WebAutostartOptions } from "../services/web-autostart.js";

/** Test seams for the handover in `web install`. */
export interface WebHandoverDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** The version this command runs as. */
  version?: string;
}

const POLL_MS = 250;
const POLL_LIMIT = 40;
const REQUEST_TIMEOUT_MS = 2_000;

/** The version an OMMS web app reports on `url`, or null when none answers with one. */
async function readWebVersion(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const response = await fetchFn(`${url}/api/settings/version`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { running?: unknown };
    return typeof body.running === "string" ? body.running : null;
  } catch {
    return null;
  }
}

async function portAnswers(fetchFn: typeof fetch, url: string): Promise<boolean> {
  try {
    await fetchFn(`${url}/api/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

type Handover =
  { kind: "none" } | { kind: "handed" } | { kind: "stuck" | "same" | "newer"; owner: string };

interface HandoverContext {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  url: string;
  port: number;
  headers: Record<string, string>;
  version: string;
}

/** Ask an older OMMS web app on the configured port to step aside, and wait for the port. */
async function negotiateOwner(ctx: HandoverContext): Promise<Handover> {
  const { compareVersions } = await import("../services/version-compare.js");
  const owner = await readWebVersion(ctx.fetchFn, ctx.url, ctx.headers);
  const order = owner === null ? null : compareVersions(owner, ctx.version);
  // A version that cannot be placed is never stopped.
  if (owner === null || order === null) return { kind: "none" };
  if (order === 0) return { kind: "same", owner };
  if (order > 0) return { kind: "newer", owner };
  try {
    const reply = await ctx.fetchFn(`${ctx.url}/api/web/step-aside`, {
      method: "POST",
      headers: { ...ctx.headers, "content-type": "application/json" },
      body: JSON.stringify({ version: ctx.version }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (reply.status !== 202) return { kind: "stuck", owner };
  } catch {
    return { kind: "stuck", owner };
  }
  // If the old app is slow to stop, the login item still takes the port later.
  for (let i = 0; i < POLL_LIMIT && (await portAnswers(ctx.fetchFn, ctx.url)); i++) {
    await ctx.sleep(POLL_MS);
  }
  return { kind: "handed" };
}

/** Print which version serves the port after `web install`. */
async function announceHandover(ctx: HandoverContext, handover: Handover): Promise<void> {
  const { url, port, version } = ctx;
  if (handover.kind === "stuck") {
    console.log(
      `OMMS ${handover.owner} holds port ${port} and cannot hand it over. Stop the web app (Ctrl+C in its terminal, or quit the session that runs it), then run om-memory-system web install again.`
    );
  } else if (handover.kind === "newer") {
    console.log(
      `OMMS ${handover.owner} already serves port ${port}. It is newer than this command (${version}). Update the global command: npm i -g om-memory-system`
    );
  } else if (handover.kind === "same") {
    console.log(`OMMS web app: ${url} (version ${handover.owner})`);
  } else if (handover.kind === "none") {
    console.log(`OMMS web app: ${url}`);
  } else {
    let serving: string | null = null;
    for (let i = 0; i < POLL_LIMIT && !serving; i++) {
      serving = await readWebVersion(ctx.fetchFn, url, ctx.headers);
      if (!serving) await ctx.sleep(POLL_MS);
    }
    if (!serving) console.log(`OMMS web app: ${url}`);
    else if (serving === version) console.log(`OMMS web app: ${url} (version ${serving})`);
    else
      console.log(
        `OMMS web app: ${url} (version ${serving}). This is not the version of this command (${version}).`
      );
  }
}

/** Run the standalone web app or manage its per-user login item. */
export async function runWebCommand(
  args: string[],
  options: WebAutostartOptions = {},
  online?: () => Promise<boolean>,
  handover: WebHandoverDeps = {}
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
  const { webServerUrl } = await import("../services/web-api-auth.js");
  const url = webServerUrl(config.CONFIG.webServerHost, config.CONFIG.webServerPort);
  if (action === "install" || action === "uninstall") {
    const { readGlobalConfigRevision, writeGlobalConfigKeys } =
      await import("../services/global-config-writer.js");
    await writeGlobalConfigKeys(
      { webServerAutoStart: action === "install" },
      readGlobalConfigRevision()
    );
    config.initConfig(home);
    let context: HandoverContext | undefined;
    let outcome: Handover = { kind: "none" };
    if (action === "install") {
      const [{ getOrCreateAuthToken, AUTH_HEADER }, { packageVersion }] = await Promise.all([
        import("../services/auth-token.js"),
        import("../services/package-version.js"),
      ]);
      const apiToken = config.CONFIG.webServerApiToken;
      context = {
        fetchFn: handover.fetch ?? fetch,
        sleep: handover.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        url,
        port: config.CONFIG.webServerPort,
        headers: {
          [AUTH_HEADER]: getOrCreateAuthToken(),
          ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
        },
        version: handover.version ?? packageVersion(),
      };
      outcome = await negotiateOwner(context);
    }
    const result =
      action === "install"
        ? installWebAutostart({ ...options, start: true })
        : removeWebAutostart({ ...options, start: true });
    console.log(`OMMS login item: ${result.state}`);
    if (context && result.state === "installed") await announceHandover(context, outcome);
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
        { setting: config.CONFIG.webServerAutoStart, item: status, url, online: await check() },
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
  let keeper = setInterval(() => {}, 60_000);
  const stop = () => {
    clearInterval(keeper);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    void server.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // The page's Stop and Restart buttons reach the same process through this callback.
  const { createPowerAction } = await import("./web-power.js");
  server.setOnPowerAction(
    createPowerAction({
      stopServer: async () => {
        clearInterval(keeper);
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        await server.stop();
      },
      // A restart whose copy failed serves again from this process.
      resumeServer: async () => {
        keeper = setInterval(() => {}, 60_000);
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        await server.start();
      },
      baseUrl: server.getUrl(),
      loginItem: action === "--login-item",
      autostart: options,
    })
  );
  // A newer `web install` asked this web app to give up the port.
  server.setOnStepAside(async () => {
    clearInterval(keeper);
    await server.stop();
    process.exit(0);
  });
  return 0;
}
