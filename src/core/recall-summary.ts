/** One memory a recall injected, reduced to what a fold row shows. */
export type RecallItem = { relevance: number; id?: string; headline: string };

/** One recall as OMMS made it: a prompt search, or the recent memories a session opens with. */
export type RecallSummary = {
  mode: "search" | "recent";
  query: string | null;
  items: RecallItem[];
};

const QUERY_CUT = 60;
const UNFOLDED_QUERY_CUT = 300;
const HEADLINE_CUT = 140;

/** Query on one line, cut to `max` characters. */
export function queryLine(query: string, max = QUERY_CUT): string {
  const line = query.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

// Entry shape comes from `formatContextForPrompt`: `<memory id="..." relevance="N%">`, with the
// id missing when the result had none. A body ends at its own `</memory>` when another entry, a
// section close or the end of the text follows it. The Claude Code hook can cut a block short and
// leave tags open, so a body also ends at an opening tag that starts a line, at a section close,
// or at the end of the text. A bare `<memory ` inside the text does not end it: a memory can
// quote the tag.
const ENTRY_OPEN = String.raw`<memory(?:\s+id="[^"]*")?\s+relevance="\d+%">`;
const SECTION_CLOSE = String.raw`<\/project_knowledge>|<\/memory_context>|<\/omms-retrieval>`;
const MEMORY_ENTRY = new RegExp(
  String.raw`<memory(?:\s+id="([^"]*)")?\s+relevance="(\d+)%">([\s\S]*?)` +
    String.raw`(?=<\/memory>\s*(?:<memory\s|${SECTION_CLOSE}|$)|\n${ENTRY_OPEN}|${SECTION_CLOSE}|$)`,
  "g"
);

/** One line that names a memory: the first line under `## Request`, else the first line. */
export function headline(body: string): string {
  const lines = body
    .replace(/<\/memory>\s*$/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.findIndex((line) => /^##\s*request/i.test(line));
  const line = (heading >= 0 ? lines[heading + 1] : lines[0]) ?? "";
  return line.length > HEADLINE_CUT ? `${line.slice(0, HEADLINE_CUT - 3)}...` : line;
}

/**
 * Summarise a formatted retrieval section for a host to show. Returns null when the section holds
 * no memory (a profile-only section included), so the host draws nothing. A `recent` recall has
 * no query, whatever the caller passes.
 */
export function buildRecallSummary(
  section: string,
  mode: "search" | "recent",
  query: string | null
): RecallSummary | null {
  const items: RecallItem[] = [];
  for (const match of section.matchAll(MEMORY_ENTRY)) {
    const text = headline(match[3] ?? "");
    if (!text) continue;
    const item: RecallItem = { relevance: Number(match[2]), headline: text };
    if (match[1]) item.id = match[1];
    items.push(item);
  }
  if (items.length === 0) return null;
  return { mode, query: mode === "recent" ? null : query, items };
}

/** `memory [mode=search, query="...", limit=4]`: the call's name and arguments, as a tool row shows them. */
export function callTitle(summary: RecallSummary): string {
  const args = [`mode=${summary.mode}`];
  if (summary.query) args.push(`query="${queryLine(summary.query)}"`);
  args.push(`limit=${summary.items.length}`);
  return `memory [${args.join(", ")}]`;
}

/** Body of an unfolded row, one string per line, without indentation (the host indents). */
export function unfoldLines(summary: RecallSummary): string[] {
  const lines = [`mode: ${summary.mode}`];
  if (summary.query) lines.push(`query: ${queryLine(summary.query, UNFOLDED_QUERY_CUT)}`);
  lines.push(`limit: ${summary.items.length}`);
  summary.items.forEach((item, index) => {
    const id = item.id ? ` id=${item.id}` : "";
    lines.push(`${index + 1}. ${item.relevance}%${id} ${item.headline}`);
  });
  return lines;
}
