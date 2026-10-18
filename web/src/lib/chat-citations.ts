export type CitationPart = { kind: "text"; text: string } | { kind: "cite"; label: string };

const MARKER = /\[([SP]\d+)\]/g;

/**
 * Splits an answer into text and citation parts. Only markers that name a
 * known source become citations; everything else stays as plain text, so the
 * page never renders answer text as HTML.
 */
export function splitCitations(text: string, labels: string[]): CitationPart[] {
  const known = new Set(labels);
  const parts: CitationPart[] = [];
  let buffer = "";
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const label = match[1]!;
    if (!known.has(label)) continue;
    buffer += text.slice(last, match.index);
    if (buffer) parts.push({ kind: "text", text: buffer });
    buffer = "";
    parts.push({ kind: "cite", label });
    last = match.index! + match[0].length;
  }
  buffer += text.slice(last);
  if (buffer) parts.push({ kind: "text", text: buffer });
  return parts;
}

/** The known labels an answer cites, in order of first use. */
export function citedLabels(text: string, labels: string[]): string[] {
  const out: string[] = [];
  for (const part of splitCitations(text, labels)) {
    if (part.kind === "cite" && !out.includes(part.label)) out.push(part.label);
  }
  return out;
}
