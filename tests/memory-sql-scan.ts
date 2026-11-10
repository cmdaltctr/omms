/**
 * Finds the SQL string literals in TypeScript source that read the `memories`
 * table, and says whether each one carries a record-kind predicate. Used by
 * memorisation-kind-filter-guard.test.ts.
 *
 * It tokenises just enough TypeScript to find string, template and regex
 * literals, so SQL in a comment or a doc block is never counted.
 */

export interface MemoryQuery {
  /** 1-based line where the literal starts. */
  line: number;
  /** The literal text with each `${...}` replaced by `${…}` and whitespace collapsed. */
  sql: string;
  /** True when the literal, including its `${...}` parts, holds a kind predicate. */
  filtered: boolean;
}

interface Literal {
  start: number;
  own: string;
  raw: string;
}

const READS_MEMORIES = /\b(?:FROM|JOIN)\s+memories\b/i;
const KIND_PREDICATE =
  /memoryKindPredicate|UNTAGGED_NORMAL_PREDICATE|type\s+IS\s+NOT\s+'memorisation'|type\s*=\s*'memorisation'/;
/** A `/` after one of these characters starts a regular expression, not a division. */
const REGEX_PRECEDERS = "(,=:[!&|?{;";

export function scanLiterals(source: string): { literals: Literal[]; clean: boolean } {
  const literals: Literal[] = [];
  const stack: Array<
    { type: "template"; start: number; own: string } | { type: "expr"; depth: number }
  > = [];
  let previous = "";
  let index = 0;
  while (index < source.length) {
    const top = stack[stack.length - 1];
    const char = source[index] as string;
    if (top?.type === "template") {
      if (char === "\\") {
        top.own += source.slice(index, index + 2);
        index += 2;
      } else if (char === "`") {
        literals.push({ start: top.start, own: top.own, raw: source.slice(top.start, index + 1) });
        stack.pop();
        previous = "`";
        index++;
      } else if (char === "$" && source[index + 1] === "{") {
        stack.push({ type: "expr", depth: 0 });
        top.own += "${…}";
        previous = "{";
        index += 2;
      } else {
        top.own += char;
        index++;
      }
      continue;
    }
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else if (char === "`") {
      stack.push({ type: "template", start: index, own: "" });
      index++;
    } else if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < source.length && source[end] !== char && source[end] !== "\n") {
        end += source[end] === "\\" ? 2 : 1;
      }
      literals.push({
        start: index,
        own: source.slice(index + 1, end),
        raw: source.slice(index, end + 1),
      });
      previous = char;
      index = end + 1;
    } else if (char === "/" && (previous === "" || REGEX_PRECEDERS.includes(previous))) {
      let end = index + 1;
      let inClass = false;
      while (end < source.length && source[end] !== "\n") {
        const here = source[end];
        if (here === "\\") end++;
        else if (here === "[") inClass = true;
        else if (here === "]") inClass = false;
        else if (here === "/" && !inClass) break;
        end++;
      }
      previous = "/";
      index = end + 1;
    } else if (top?.type === "expr" && char === "}" && top.depth === 0) {
      stack.pop();
      index++;
    } else {
      if (top?.type === "expr" && char === "{") top.depth++;
      if (top?.type === "expr" && char === "}") top.depth--;
      if (!/\s/.test(char)) previous = char;
      index++;
    }
  }
  return { literals, clean: stack.length === 0 };
}

/** Every SQL literal in `source` that reads the memories table. */
export function memoryQueries(source: string): { queries: MemoryQuery[]; clean: boolean } {
  const { literals, clean } = scanLiterals(source);
  const queries = literals
    .filter((literal) => READS_MEMORIES.test(literal.own))
    .map((literal) => ({
      line: source.slice(0, literal.start).split("\n").length,
      sql: literal.own.replace(/\s+/g, " ").trim(),
      filtered: KIND_PREDICATE.test(literal.raw),
    }));
  return { queries, clean };
}
