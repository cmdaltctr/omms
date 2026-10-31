import type { WebHost } from "$lib/host-label";
import { navigate, ROUTES } from "$lib/router";
import { JUMP } from "$lib/settings-navigation";

/** Reveal only the requested host; native anchor navigation supplies the scroll. */
export function revealDirectoryMaps(host: WebHost) {
  const summary = document.getElementById(`directory-maps-${host}`);
  const disclosure = summary?.parentElement as HTMLDetailsElement | null;
  if (!summary || !disclosure) {
    if (typeof window !== "undefined" && window.location)
      navigate(`${ROUTES.memory}#directory-maps-${host}`);
    return;
  }
  disclosure.open = true;
  summary.focus({ preventScroll: true });
  summary.scrollIntoView?.(JUMP);
}
