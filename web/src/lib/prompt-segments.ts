export type PromptSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "pasted"; text: string };

export type InlineSegment = { code: boolean; text: string };

// Closed blocks only. An unterminated tag stays plain text so nothing is hidden.
const BLOCK = /<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content[^>]*>|```[^\n]*\n([\s\S]*?)```/g;

function trimEdgeNewlines(text: string): string {
  return text.replace(/^\n+|\n+$/g, "");
}

/** Splits a stored user prompt into prose, fenced code, and pasted terminal blocks. */
export function splitPrompt(content: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const pushText = (raw: string) => {
    const text = trimEdgeNewlines(raw);
    if (text.trim()) segments.push({ kind: "text", text });
  };
  let last = 0;
  for (const match of content.matchAll(BLOCK)) {
    pushText(content.slice(last, match.index));
    const pasted = match[1] !== undefined;
    segments.push({
      kind: pasted ? "pasted" : "code",
      text: trimEdgeNewlines(pasted ? match[1] : match[2]),
    });
    last = match.index + match[0].length;
  }
  pushText(content.slice(last));
  return segments;
}

/** Splits prose on single-backtick spans so commands can render as code. */
export function splitInlineCode(text: string): InlineSegment[] {
  const parts: InlineSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match.index > last) parts.push({ code: false, text: text.slice(last, match.index) });
    parts.push({ code: true, text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts;
}
