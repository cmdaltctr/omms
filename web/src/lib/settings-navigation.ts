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
  if (!/^settings-section-[a-z0-9-]+$/.test(id)) return false;
  const card = doc.getElementById(id);
  if (!card) return false;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}
