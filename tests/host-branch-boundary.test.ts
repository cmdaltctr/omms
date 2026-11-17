import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { srcRoot, tsFiles } from "./source-imports.js";

// Shared code reads host facts from the registry (`src/shared/hosts.ts`,
// `src/importer/host-importers.ts`), so it never compares or lists host ids.
// "claude" is Claude Code's command name, as in `import-claude-history`.
const HOST_IDS = new Set(["pi", "opencode", "claude-code", "claude"]);

// Host code, the registry itself, and the one file CLAUDE.md names for the live-model rule.
const allowedAreas = [
  "adapters",
  "v2",
  "plugin.ts",
  "shared/hosts.ts",
  "importer/host-importers.ts",
  "services/ai/live-model-choice.ts",
];

const equalityOperators = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

function isHostId(node: ts.Node): boolean {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    HOST_IDS.has(node.text)
  );
}

const isHostType = (node: ts.TypeNode): boolean =>
  ts.isLiteralTypeNode(node) && isHostId(node.literal);

/** How many host ids a regex literal names as whole words, as in `/^(pi|opencode)$/`. */
function regexHostCount(literal: string): number {
  // Drop escapes such as `\b`, so `\bpi\b` still reads as the word "pi".
  const body = literal.slice(1, literal.lastIndexOf("/")).replace(/\\[A-Za-z]/g, " ");
  return [...HOST_IDS].filter((id) =>
    new RegExp(`(^|[^\\w-])${id.replace("-", "\\-")}($|[^\\w-])`).test(body)
  ).length;
}

/** `new Set([...])` with two or more host ids, or `new Map([...])` with two or more host keys. */
function isHostKeyedCollection(node: ts.Node): boolean {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) return false;
  const entries = node.arguments?.[0];
  if (!entries || !ts.isArrayLiteralExpression(entries)) return false;
  const keys =
    node.expression.text === "Map"
      ? entries.elements.map((entry) =>
          ts.isArrayLiteralExpression(entry) ? entry.elements[0] : undefined
        )
      : node.expression.text === "Set"
        ? [...entries.elements]
        : [];
  return keys.filter((key) => key !== undefined && isHostId(key)).length >= 2;
}

/**
 * Returns the 1-based lines of `source` that compare a host id, switch on one,
 * or list two or more (in an array, a union type, a regex, a `Set` or `Map` keys).
 * The syntax tree skips comments and text that only mentions a host.
 */
function hostBranchLines(source: string, fileName = "inline.ts"): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    const found =
      (ts.isBinaryExpression(node) &&
        equalityOperators.has(node.operatorToken.kind) &&
        (isHostId(node.left) || isHostId(node.right))) ||
      (ts.isCaseClause(node) && isHostId(node.expression)) ||
      (ts.isArrayLiteralExpression(node) && node.elements.filter(isHostId).length >= 2) ||
      (ts.isUnionTypeNode(node) && node.types.filter(isHostType).length >= 2) ||
      (node.kind === ts.SyntaxKind.RegularExpressionLiteral &&
        regexHostCount((node as ts.RegularExpressionLiteral).text) >= 2) ||
      isHostKeyedCollection(node);
    if (found) lines.add(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...lines].sort((a, b) => a - b);
}

describe("host branch boundary", () => {
  it("finds a host comparison, a host case and a host list", () => {
    expect(hostBranchLines('if (host === "pi") run();')).toEqual([1]);
    expect(hostBranchLines('if ("opencode" != host) run();')).toEqual([1]);
    expect(hostBranchLines('switch (host) {\n  case "claude-code":\n    break;\n}')).toEqual([2]);
    expect(hostBranchLines('const order = ["pi", "opencode"];')).toEqual([1]);
    expect(hostBranchLines('if (name === "claude") run();')).toEqual([1]);
  });

  it("finds a host union type, a host regex and a host-keyed Set or Map", () => {
    expect(hostBranchLines('function f(host: "pi" | "opencode" | "claude-code") {}')).toEqual([1]);
    expect(hostBranchLines("const ok = /^(pi|opencode|claude-code)$/.test(host);")).toEqual([1]);
    expect(hostBranchLines("const ok = /\\bpi\\b|\\bopencode\\b/.test(host);")).toEqual([1]);
    expect(hostBranchLines('const s = new Set(["pi", "claude-code"]);')).toEqual([1]);
    expect(hostBranchLines('const m = new Map([\n  ["pi", 1],\n  ["opencode", 2],\n]);')).toEqual([
      1,
    ]);
  });

  it("ignores a union, regex, Set or Map with at most one host id", () => {
    expect(hostBranchLines('type T = "pi" | "other";')).toEqual([]);
    expect(hostBranchLines("const ok = /^pi$|api|opencoder/.test(host);")).toEqual([]);
    expect(hostBranchLines('const m = new Map([["pi", 1], ["other", 2]]);')).toEqual([]);
    expect(hostBranchLines('const m = new Map([[1, "pi"], [2, "opencode"]]);')).toEqual([]);
  });

  it("ignores comments, messages and a single host string", () => {
    expect(hostBranchLines("// opencode\nconst x = 1;")).toEqual([]);
    expect(hostBranchLines('throw new Error("opencode is busy");')).toEqual([]);
    expect(hostBranchLines('const host = "pi";\nconst list = ["pi", "other"];')).toEqual([]);
  });

  it("keeps host-name branches out of shared src/ code", () => {
    const shared = tsFiles(".").filter(
      (file) => !allowedAreas.some((area) => file === area || file.startsWith(`${area}/`))
    );
    // Guards the scan: an empty file list would pass the check below.
    expect(shared).toContain("services/web-server.ts");
    const offenders = shared.flatMap((file) =>
      hostBranchLines(readFileSync(join(srcRoot, file), "utf8"), file).map(
        (line) => `src/${file}:${line}`
      )
    );
    expect(offenders).toEqual([]);
  });
});
