const MARKER = /\[([SP]\d+)\]/g;

/**
 * Swaps known citation markers in sanitised answer HTML for buttons. The label
 * matches `[SP]\d+`, so nothing from the answer reaches the markup unescaped.
 * The page opens the source from the button's `data-cite` value.
 */
export function linkCitations(
  html: string,
  labels: string[],
  isDeleted: (label: string) => boolean,
  ariaLabel: (label: string) => string
): string {
  const known = new Set(labels);
  return html.replace(MARKER, (marker, label: string) => {
    if (!known.has(label)) return marker;
    const classes = ["cite-chip"];
    if (label.startsWith("P")) classes.push("cite-profile");
    if (isDeleted(label)) classes.push("cite-deleted");
    const aria = ariaLabel(label).replace(/["&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
    return `<button type="button" class="${classes.join(" ")}" data-cite="${label}" aria-haspopup="dialog" aria-label="${aria}">${label}</button>`;
  });
}
