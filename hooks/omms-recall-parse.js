// Reads the memories out of the context the OMMS hooks inject, for the recall
// rows in `omms-recall.jsx`. It has no imports, so Claude Code's module loader
// and Bun's contract test (`tests/claude-recall-parse-contract.test.ts`) both
// load this one file.
//
// A recall item is `{ relevance, id, text }`. `relevance` is null for a
// restored-session memory, which has none. `id` is null when the text has none.

const SECTION = /<omms-retrieval>[\s\S]*?(?:<\/omms-retrieval>|$)/g;
// A memory runs to the next one, the end of the section or the end of the text:
// the hook can cut a section short, so the closing tag is optional.
const MEMORY =
  /<memory (?:id="([^"]*)" )?relevance="(\d+)%">([\s\S]*?)(?=<memory |<\/project_knowledge>|<\/omms-retrieval>|$)/g;
// A restored-session section after compaction or a resume: `### Memory N (id)`.
const RESTORED_HEADER = "## Restored Session Memory";
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

/** The memories in the `<omms-retrieval>` sections of one injected text. Empty when it holds none. */
export function recalledIn(text) {
  const found = [];
  for (const section of text.match(SECTION) ?? []) {
    for (const match of section.matchAll(MEMORY)) {
      const line = headline(match[3] ?? "");
      if (line) found.push({ relevance: Number(match[2]), id: match[1] ?? null, text: line });
    }
    if (!section.includes(RESTORED_HEADER)) continue;
    for (const match of section.matchAll(RESTORED)) {
      const line = headline(match[2] ?? "");
      if (line) found.push({ relevance: null, id: match[1] ?? null, text: line });
    }
  }
  return found;
}
