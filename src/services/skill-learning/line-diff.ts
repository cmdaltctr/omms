/** Unchanged lines shown around each change. */
const CONTEXT_LINES = 3;

type Op = { kind: " " | "-" | "+"; line: string };

/** Lines of a text. A final newline does not add an empty line. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Keep, remove and add steps from `before` to `after`, by longest common subsequence. */
function diffOps(before: string[], after: string[]): Op[] {
  // The shared start and end need no table; skill edits are usually local.
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
    endA--;
    endB--;
  }
  const a = before.slice(start, endA);
  const b = after.slice(start, endB);
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: Op[] = before.slice(0, start).map((line) => ({ kind: " ", line }));
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i++]! });
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: "-", line: a[i++]! });
    } else {
      ops.push({ kind: "+", line: b[j++]! });
    }
  }
  while (i < a.length) ops.push({ kind: "-", line: a[i++]! });
  while (j < b.length) ops.push({ kind: "+", line: b[j++]! });
  for (const line of before.slice(endA)) ops.push({ kind: " ", line });
  return ops;
}

/**
 * A unified-style line diff: `@@ -start,count +start,count @@` hunks with
 * three lines of context, then lines marked ` `, `-` or `+`. Empty when the
 * texts have the same lines. The web page renders it as text.
 */
export function lineDiff(before: string, after: string): string {
  const ops = diffOps(splitLines(before), splitLines(after));
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (op.kind !== "+") oldLine++;
    if (op.kind !== "-") newLine++;
  }
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]));
  const out: string[] = [];
  for (let h = 0; h < changed.length; h++) {
    const first = changed[h]!;
    while (h + 1 < changed.length && changed[h + 1]! - changed[h]! <= 2 * CONTEXT_LINES) h++;
    const from = Math.max(0, first - CONTEXT_LINES);
    const to = Math.min(ops.length - 1, changed[h]! + CONTEXT_LINES);
    const hunk = ops.slice(from, to + 1);
    const oldCount = hunk.filter((op) => op.kind !== "+").length;
    const newCount = hunk.filter((op) => op.kind !== "-").length;
    // A side with no lines names the line before the hunk, as unified diffs do.
    const oldStart = oldCount > 0 ? oldAt[from]! : oldAt[from]! - 1;
    const newStart = newCount > 0 ? newAt[from]! : newAt[from]! - 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of hunk) out.push(op.kind + op.line);
  }
  return out.join("\n");
}
