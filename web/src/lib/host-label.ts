import { HOST_INFO, isMemoryHost, type MemoryHost } from "$shared/hosts";

export type WebHost = MemoryHost;

/** The host's display name on the Settings page. Product names are not translated. */
export function hostLabel(host: WebHost): string {
  return HOST_INFO[host].label;
}

/** A host id from the server as its display name; an unknown id is shown as sent. */
export function hostName(host: string): string {
  return isMemoryHost(host) ? HOST_INFO[host].label : host;
}
