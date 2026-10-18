import { join } from "node:path";
import { HostAppearanceError, createHostAppearance } from "./host-appearance.js";

type Appearance = ReturnType<typeof createHostAppearance>;
const instances = new Map<string, Appearance>();

function appearanceFor(storagePath: string): Appearance {
  const directory = join(storagePath, "host-appearance");
  let appearance = instances.get(directory);
  if (!appearance) {
    appearance = createHostAppearance(directory);
    instances.set(directory, appearance);
  }
  return appearance;
}

const refused = (error: unknown) => {
  if (error instanceof HostAppearanceError) {
    return { status: error.status, body: { success: false, error: error.message } };
  }
  throw error;
};

/**
 * Routes for the Memory page: whether memories can be saved, and each host's
 * avatar. Returns undefined for paths it does not own. The web token check
 * runs before this, for every `/api/` path.
 */
export async function routeMemoryHosts(
  path: string,
  method: string,
  url: URL,
  readBody: () => Promise<any>,
  config: { storagePath: string }
): Promise<{ status: number; body: unknown } | undefined> {
  if (path === "/api/memory/write-health" && method === "GET") {
    const { checkWriteHealth } = await import("./write-health-checks.js");
    return { status: 200, body: await checkWriteHealth(url.searchParams.get("fresh") === "1") };
  }

  if (path === "/api/host-appearance" && method === "GET") {
    return { status: 200, body: { hosts: await appearanceFor(config.storagePath).read() } };
  }

  const host = /^\/api\/host-appearance\/([^/]+)$/.exec(path)?.[1];
  if (!host) return undefined;
  const appearance = appearanceFor(config.storagePath);
  try {
    if (method === "PUT") {
      const body = await readBody();
      if (body?.kind === "icon") await appearance.setIcon(host, body.icon);
      else if (body?.kind === "image") await appearance.setImage(host, body.png);
      else throw new HostAppearanceError("Choose an icon or an image");
      return { status: 200, body: { hosts: await appearance.read() } };
    }
    if (method === "DELETE") {
      await appearance.reset(host);
      return { status: 200, body: { hosts: await appearance.read() } };
    }
  } catch (error) {
    return refused(error);
  }
  return undefined;
}
