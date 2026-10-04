import type { WebHost } from "$lib/host-label";

/** Reveal only the requested host; native anchor navigation supplies the scroll. */
export function revealDirectoryMaps(host: WebHost) {
  const summary = document.getElementById(`directory-maps-${host}`);
  const disclosure = summary?.parentElement as HTMLDetailsElement | null;
  if (!summary || !disclosure) return;
  disclosure.open = true;
  summary.focus({ preventScroll: true });
}
