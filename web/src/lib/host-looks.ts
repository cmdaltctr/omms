import { useEffect, useSyncExternalStore } from "react";
import { settingsRequest } from "./settings-api";
import type { WebHost } from "./host-label";

export type HostLook =
  { kind: "default" } | { kind: "icon"; icon: string } | { kind: "image"; image: string };
export type HostLooks = Record<WebHost, HostLook>;

const DEFAULT_LOOKS: HostLooks = {
  pi: { kind: "default" },
  opencode: { kind: "default" },
  "claude-code": { kind: "default" },
};

let looks: HostLooks = DEFAULT_LOOKS;
let loaded = false;
const listeners = new Set<() => void>();
const publish = (next: HostLooks) => {
  looks = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

async function request(path: string, init?: RequestInit): Promise<void> {
  const result = await settingsRequest<{ hosts: HostLooks }>(path, init);
  publish({ ...DEFAULT_LOOKS, ...result.hosts });
}

/** Every host's avatar choice, shared by the cards, the switcher and the sidebar. */
export function useHostLooks() {
  const current = useSyncExternalStore(
    subscribe,
    () => looks,
    () => DEFAULT_LOOKS
  );
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void request("/api/host-appearance").catch(() => {
      loaded = false;
    });
  }, []);
  return {
    looks: current,
    setIcon: (host: WebHost, icon: string) =>
      request(`/api/host-appearance/${host}`, {
        method: "PUT",
        body: JSON.stringify({ kind: "icon", icon }),
      }),
    setImage: (host: WebHost, png: string) =>
      request(`/api/host-appearance/${host}`, {
        method: "PUT",
        body: JSON.stringify({ kind: "image", png }),
      }),
    reset: (host: WebHost) => request(`/api/host-appearance/${host}`, { method: "DELETE" }),
  };
}
