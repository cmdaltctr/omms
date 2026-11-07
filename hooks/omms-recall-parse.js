// Reads the memories out of the context the OMMS hooks inject, for the recall
// rows in `omms-recall.jsx`. It has no imports, so Claude Code's module loader
// and Bun's contract test (`tests/claude-recall-parse-contract.test.ts`) both
// load this one file.
//
// A recall item is `{ relevance, id, text }`. `relevance` is null for a
// restored-session memory, which has none. `id` is null when the text has none.
//
// The hook adds one marker line right after a section's opening tag when it
// has something to say about the section. `<!--omms:rows-off-->` means draw no
// row (setting `visibleRecall`, and every subagent section).
// `<!--omms:opening query="..."-->` names the opening section and its query.

const SECTION = /<omms-retrieval>[\s\S]*?(?:<\/omms-retrieval>|$)/g;
// A memory runs to the next one, the end of the section or the end of the text:
// the hook can cut a section short, so the closing tag is optional. A linked
// memory carries `space="..."` after `relevance`; the rows do not show it.
const MEMORY =
  /<memory (?:id="([^"]*)" )?relevance="(\d+)%"(?: space="[^"]*")?>([\s\S]*?)(?=<memory |<\/project_knowledge>|<\/omms-retrieval>|$)/g;
// A restored-session section after compaction or a resume: `### Memory N (id)`.
const RESTORED_HEADER = "## Restored Session Memory";
const ROWS_OFF = "<omms-retrieval>\n<!--omms:rows-off-->\n";
const OPENING = /^<omms-retrieval>\n<!--omms:opening query="([^"]*)"-->\n/;
const RESTORED =
  /### Memory \d+(?: \(([^)\n]+)\))?\n([\s\S]*?)(?=### Memory \d+|<\/omms-retrieval>|$)/g;

/** The query on one line, cut to `max` characters. */
export function queryLine(query, max = 60) {
  const line = query.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/** `memory [mode=search, query="...", limit=4]`: the call's name and arguments, as a tool row shows them. */
export function callTitle(call) {
  const args = [`mode=${call.mode}`];
  if (call.query) args.push(`query="${queryLine(call.query)}"`);
  args.push(`limit=${call.items.length}`);
  return `memory [${args.join(", ")}]`;
}

/** One line that names a memory: the first line after the `## Request` heading, or the first line. */
export function headline(body) {
  const lines = body
    .replace(/<\/memory>\s*$/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.findIndex((line) => /^##\s*request/i.test(line));
  const line = (heading >= 0 ? lines[heading + 1] : lines[0]) ?? "";
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

/** True when the section carries the rows-off marker. */
export function rowsOff(text) {
  return text.includes(ROWS_OFF);
}

/** True when the section is a restored-session section. */
export function restored(text) {
  return text.includes(RESTORED_HEADER);
}

/** The query in the section's opening marker, or null when it has none. */
export function openingQuery(text) {
  return OPENING.exec(text)?.[1] ?? null;
}

/** The memories in the `<omms-retrieval>` sections of one injected text. Empty when it holds none. */
export function recalledIn(text) {
  const found = [];
  for (const section of text.match(SECTION) ?? []) {
    for (const match of section.matchAll(MEMORY)) {
      const line = headline(match[3] ?? "");
      if (line) found.push({ relevance: Number(match[2]), id: match[1] ?? null, text: line });
    }
    if (!restored(section)) continue;
    for (const match of section.matchAll(RESTORED)) {
      const line = headline(match[2] ?? "");
      if (line) found.push({ relevance: null, id: match[1] ?? null, text: line });
    }
  }
  return found;
}

/**
 * The rows to draw for one injected text, one per section in order:
 * `{ kind, query, items }`. `kind` is `restore`, `opening` or `search`. `query`
 * is the opening marker's query, and null otherwise (the module adds the
 * prompt for `search`). A rows-off section, or one with no memories, gives none.
 */
export function sectionsIn(text) {
  const found = [];
  for (const section of text.match(SECTION) ?? []) {
    if (rowsOff(section)) continue;
    const items = recalledIn(section);
    if (items.length === 0) continue;
    const query = openingQuery(section);
    const kind = restored(section) ? "restore" : query !== null ? "opening" : "search";
    found.push({ kind, query, items });
  }
  return found;
}
