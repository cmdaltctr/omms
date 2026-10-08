/**
 * Bring the Settings card named by the page URL's hash into view after the
 * page mounts. The browser's own hash jump happens while React has not yet
 * rendered the cards, so a direct load or reload of
 * /settings#settings-section-... needs this scroll. Sidebar links scroll
 * themselves after navigation; host-specific Directory maps disclosures keep
 * revealDirectoryMaps in web/src/lib/directory-map-navigation.ts.
 */
export function revealSettingsAnchor(hash: string, doc: Document): boolean {
  const id = hash.startsWith("#") ? hash.slice(1) : "";
  if (!/^(settings|memory)-section-[a-z0-9-]+$/.test(id)) return false;
  const card = doc.getElementById(id);
  if (!card) return false;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

/** Reveal an anchor after navigation without replacing any mounted draft owner. */
export function revealPageAnchor(hash: string): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;
  const id = hash.replace(/^#/, "");
  if (
    !/^(?:(?:settings|memory)-section-[a-z0-9-]+|directory-maps-(?:pi|opencode|claude-code)|profile-(?:preferences|patterns|workflows))$/.test(
      id
    )
  )
    return;
  let tries = 0;
  const reveal = () => {
    const element = document.getElementById(id);
    if (!element) {
      if (tries++ < 50) requestAnimationFrame(reveal);
      return;
    }
    if (id.startsWith("directory-maps-")) {
      const disclosure = element.parentElement as HTMLDetailsElement | null;
      if (disclosure) disclosure.open = true;
      element.focus({ preventScroll: true });
    }
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  requestAnimationFrame(reveal);
}
