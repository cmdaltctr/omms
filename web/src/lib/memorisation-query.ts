/** A comma between labels: ASCII, Chinese full-width or Arabic. */
const COMMA = /[,\uFF0C\u060C]/;

/** A bar between labels means OR. A comma means AND. */
const OR_BAR = "|";

/** `label:name` or `label:"two words"`, at the start of the text or after a space or comma. */
const LABEL_TOKEN = /(^|[\s,\uFF0C\u060C])label:(?:"([^"]*)"|([^\s,\uFF0C\u060C]*))/gi;

/** Adds `label` unless the list already has it, ignoring case. */
export function withLabel(labels: readonly string[], label: string): string[] {
  const wanted = label.trim();
  if (!wanted || labels.some((own) => own.toLowerCase() === wanted.toLowerCase())) {
    return [...labels];
  }
  return [...labels, wanted];
}

/** One label entry: words kept apart by single spaces, and the alternatives of a bar joined as `a|b`. */
function labelEntry(part: string): string {
  const alternatives = part
    .split(OR_BAR)
    .map((alternative) => alternative.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return alternatives
    .reduce<string[]>((kept, alternative) => withLabel(kept, alternative), [])
    .join(OR_BAR);
}

/**
 * Splits the recall box text into the query and the labels. `label:X` may repeat. The server
 * matches labels without regard to case, so `label:A` and `label:a` count once.
 * Text with a comma or a bar is a list of labels, such as `runpod, server, 4090`, and leaves no
 * query. A comma means AND. A bar means OR, so `runpod | vast, 4090` becomes the labels
 * `runpod|vast` and `4090`: a record needs 4090 and either of the others.
 */
export function parseRecallInput(input: string): { q: string; labels: string[] } {
  let labels: string[] = [];
  const rest = input.replace(
    LABEL_TOKEN,
    (_match, before: string, quoted?: string, bare?: string) => {
      labels = withLabel(labels, quoted ?? bare ?? "");
      // Keep a comma before the term, so the text is still read as a list.
      return `${before} `;
    }
  );
  if (COMMA.test(rest) || rest.includes(OR_BAR)) {
    for (const part of rest.split(COMMA)) labels = withLabel(labels, labelEntry(part));
    return { q: "", labels };
  }
  return { q: rest.replace(/\s+/g, " ").trim(), labels };
}

/** The labels of a URL query string such as `?labels=a,b`. */
export function labelsFromSearch(search: string): string[] {
  const value = new URLSearchParams(search).get("labels") ?? "";
  return value.split(",").reduce<string[]>((labels, part) => withLabel(labels, part), []);
}

/**
 * The query string for these labels: other parameters stay, `labels` is replaced or removed.
 * Commas between labels stay readable; a comma inside a label cannot be filtered on.
 */
export function searchWithLabels(search: string, labels: readonly string[]): string {
  const params = new URLSearchParams(search);
  params.delete("labels");
  const others = params.toString();
  const parts = others ? [others] : [];
  if (labels.length > 0) parts.push(`labels=${labels.map(encodeURIComponent).join(",")}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
