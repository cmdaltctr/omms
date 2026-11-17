/**
 * Jump straight to a card. A smooth scroll did not move the page at all in
 * Orca's built-in browser, so every Settings and Memory link stayed put.
 */
export const JUMP: ScrollIntoViewOptions = { block: "start" };

/**
 * Outline the card just reached for a moment, so the reader sees where the
 * link went. A card near the page end cannot reach the top of the window.
 */
export function flashAnchor(element: Element): void {
  const list = (element as HTMLElement).classList;
  if (!list) return;
  list.remove("anchor-flash");
  // Restart the animation when the same card is picked twice.
  void (element as HTMLElement).offsetWidth;
  list.add("anchor-flash");
  setTimeout(() => list.remove("anchor-flash"), 1600);
}

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
  card.scrollIntoView(JUMP);
  flashAnchor(card);
  return true;
}

/**
 * Move keyboard focus to the card's heading, or a Shared row's summary, so keyboard and screen
 * reader users land on the card a search result opened. The page has already scrolled.
 */
export function focusAnchorHeading(element: HTMLElement): void {
  const target = element.querySelector<HTMLElement>("summary, h2, h3") ?? element;
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
  }
  target.focus({ preventScroll: true });
}

/**
 * Reveal an anchor after navigation without replacing any mounted draft owner. `focus` also
 * moves keyboard focus to the card (a settings search result).
 */
export function revealPageAnchor(hash: string, options: { focus?: boolean } = {}): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;
  const id = hash.replace(/^#/, "");
  if (
    !/^(?:(?:settings|memory|skills)-section-[a-z0-9-]+|space-card-[a-z0-9-]+|directory-maps-(?:pi|opencode|claude-code)|shared-(?:profile|limits|keywords|reranker|directory-maps)|host-unresolved|memory-injection|memorisation-settings|profile-(?:preferences|patterns|workflows))$/.test(
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
    if (id.startsWith("shared-")) {
      // A Shared row is a disclosure; open it so the target is visible.
      const disclosure = element.closest("details");
      if (disclosure) disclosure.open = true;
    }
    if (id.startsWith("directory-maps-")) {
      const disclosure = element.parentElement as HTMLDetailsElement | null;
      if (disclosure) disclosure.open = true;
      element.focus({ preventScroll: true });
    }
    element.scrollIntoView(JUMP);
    flashAnchor(element);
    if (options.focus) focusAnchorHeading(element);
  };
  requestAnimationFrame(reveal);
}
