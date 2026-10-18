const MARKER = /\[([SP]\d+)\]/g;
// One tag, with quoted attribute values kept whole so a ">" inside a value does not end it.
const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const TAG_NAME = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/;
// Markers stay literal in code, and a button must not sit inside a link or another button.
const LITERAL = new Set(["a", "code", "pre", "button"]);

/**
 * Swaps known citation markers in sanitised answer HTML for buttons. Only text
 * outside tags changes, so attribute values stay as they were. The label
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
  const button = (marker: string, label: string) => {
    if (!known.has(label)) return marker;
    const classes = ["cite-chip"];
    if (label.startsWith("P")) classes.push("cite-profile");
    if (isDeleted(label)) classes.push("cite-deleted");
    const aria = ariaLabel(label).replace(/["&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
    return `<button type="button" class="${classes.join(" ")}" data-cite="${label}" aria-haspopup="dialog" aria-label="${aria}">${label}</button>`;
  };

  let out = "";
  let last = 0;
  let literalDepth = 0;
  const text = (from: number, to: number) => {
    const part = html.slice(from, to);
    out += literalDepth > 0 ? part : part.replace(MARKER, button);
  };
  for (const tag of html.matchAll(TAG)) {
    text(last, tag.index);
    out += tag[0];
    last = tag.index + tag[0].length;
    const name = TAG_NAME.exec(tag[0]);
    if (!name || !LITERAL.has(name[2]!.toLowerCase())) continue;
    if (name[1]) literalDepth = Math.max(0, literalDepth - 1);
    else literalDepth += 1;
  }
  text(last, html.length);
  return out;
}
