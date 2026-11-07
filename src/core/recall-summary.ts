/** One memory a recall injected, reduced to what a fold row shows. A restored memory has no relevance. */
export type RecallItem = { relevance: number | null; id?: string; headline: string };

/**
 * One recall as OMMS made it: a prompt search, the opening search with the configured query, a
 * restored session after compaction or resume, or the recent memories a session opens with.
 */
export type RecallSummary = {
  mode: "search" | "recent" | "opening" | "restore";
  query: string | null;
  items: RecallItem[];
  /** Per-session counter the v2 reporter sets when it stores the summary; the TUI keys rows by it. */
  seq?: number;
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
// id missing when the result had none. A linked memory carries further attributes after the
// relevance (`space="..."`), so any number of them may sit before the tag closes. A body ends at
// its own `</memory>` when another entry, a section close or the end of the text follows it. The
// Claude Code hook can cut a block short and leave tags open, so a body also ends at a section
// close or at the end of the text. An opening tag inside the text, even at the start of a line,
// does not end it: a memory can quote the tag.
const SECTION_CLOSE = String.raw`<\/project_knowledge>|<\/memory_context>|<\/omms-retrieval>`;
const MEMORY_ENTRY = new RegExp(
  String.raw`<memory(?:\s+id="([^"]*)")?\s+relevance="(\d+)%"(?:\s+[a-z][a-z-]*="[^"]*")*>([\s\S]*?)` +
    String.raw`(?=<\/memory>\s*(?:<memory\s|${SECTION_CLOSE}|$)|${SECTION_CLOSE}|$)`,
  "g"
);

// A restored-session section from `formatMemoriesForCompaction`: `### Memory N (id)`, no relevance.
// Same rule as the Claude Code parser (`hooks/omms-recall-parse.js`).
const RESTORED_ENTRY =
  /### Memory \d+(?: \(([^)\n]+)\))?\n([\s\S]*?)(?=### Memory \d+|<\/omms-retrieval>|$)/g;

/** One line that names a memory: the first line under `## Request`, else the first line. */
export function headline(body: string): string {
  const lines = body
    .replace(/<\/memory>\s*$/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.findIndex((line) => /^##\s*request\s*$/i.test(line));
  const line = (heading >= 0 ? lines[heading + 1] : lines[0]) ?? "";
  return line.length > HEADLINE_CUT ? `${line.slice(0, HEADLINE_CUT - 3)}...` : line;
}

/**
 * Summarise a formatted retrieval section for a host to show. Returns null when the section holds
 * no memory (a profile-only section included), so the host draws nothing. A `restore` summary
 * reads the restored-session entries, with no relevance. A `restore` or `recent` recall has no
 * query, whatever the caller passes.
 */
export function buildRecallSummary(
  section: string,
  mode: RecallSummary["mode"],
  query: string | null
): RecallSummary | null {
  const items: RecallItem[] = [];
  const restore = mode === "restore";
  for (const match of section.matchAll(restore ? RESTORED_ENTRY : MEMORY_ENTRY)) {
    const text = headline((restore ? match[2] : match[3]) ?? "");
    if (!text) continue;
    const item: RecallItem = { relevance: restore ? null : Number(match[2]), headline: text };
    if (match[1]) item.id = match[1];
    items.push(item);
  }
  if (items.length === 0) return null;
  return { mode, query: restore || mode === "recent" ? null : query, items };
}

/** Escape backslashes and double quotes so the quoted value in the title reads as one string. */
function escapeQuoted(text: string): string {
  return text.replace(/[\\"]/g, "\\$&");
}

/** `memory [mode=search, query="...", limit=4]`: the call's name and arguments, as a tool row shows them. */
export function callTitle(summary: RecallSummary): string {
  const args = [`mode=${summary.mode}`];
  if (summary.query) args.push(`query="${escapeQuoted(queryLine(summary.query))}"`);
  args.push(`limit=${summary.items.length}`);
  return `memory [${args.join(", ")}]`;
}

/** Body of an unfolded row, one string per line, without indentation (the host indents). */
export function unfoldLines(summary: RecallSummary): string[] {
  const lines = [`mode: ${summary.mode}`];
  if (summary.query) lines.push(`query: ${queryLine(summary.query, UNFOLDED_QUERY_CUT)}`);
  lines.push(`limit: ${summary.items.length}`);
  summary.items.forEach((item, index) => {
    const relevance = item.relevance === null ? "" : `${item.relevance}%`;
    const id = item.id ? `id=${item.id}` : "";
    lines.push(`${index + 1}. ${[relevance, id, item.headline].filter(Boolean).join(" ")}`);
  });
  return lines;
}
