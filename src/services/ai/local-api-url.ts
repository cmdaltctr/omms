const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when the URL names this machine, so a model server there may run without a key. */
export function isLocalApiUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}
