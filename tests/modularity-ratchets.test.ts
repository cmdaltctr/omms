import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { scanLiterals } from "./memory-sql-scan.js";
import { resolveSpecifier, srcRoot, tsFiles } from "./source-imports.js";

// Ratchets on known modularity debt, in the style of file-size-ceiling.test.ts.
// Each baseline lists the files that carry the debt today, with a count per
// file. A file may lose uses but never gain one, and a new file starts at 0.
// When a listed file reaches 0, delete its entry; the stale check fails until you do.

// The storage port is the only folder that may import the engine or hold SQL. The engine
// folder is the other: it is the implementation behind the port (design D6).
const STORAGE_FOLDER = "services/storage";
const ENGINE_FOLDER = "services/turso";

interface ImportSite {
  specifier: string;
  typeOnly: boolean;
}

/**
 * Lists every import site of a `src/` file: `import` and `export ... from`,
 * `import()`, `require()` and `import("x")` types. Only `import type`,
 * `export type` and `import("x")` types count as type-only: with
 * `verbatimModuleSyntax`, `import { type X }` still loads the module.
 */
function importSites(file: string, text = readFileSync(join(srcRoot, file), "utf8")): ImportSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const sites: ImportSite[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(node)
        ? (node.importClause?.isTypeOnly ?? false)
        : node.isTypeOnly;
      sites.push({ specifier: node.moduleSpecifier.text, typeOnly });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      sites.push({ specifier: node.arguments[0].text, typeOnly: false });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      sites.push({ specifier: node.argument.literal.text, typeOnly: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

function resolved(file: string, specifier: string): string {
  return specifier.startsWith(".") ? resolveSpecifier(file, specifier) : specifier;
}

function inArea(path: string, area: string): boolean {
  return path === area || path.startsWith(`${area}/`);
}

// Non-type imports of src/config.ts from core and services. Follow-up: config injection.
function configImports(file: string): number {
  if (!inArea(file, "core") && !inArea(file, "services")) return 0;
  return importSites(file).filter(
    (site) => !site.typeOnly && resolved(file, site.specifier) === "config.ts"
  ).length;
}

function inStorage(file: string): boolean {
  return inArea(file, STORAGE_FOLDER) || inArea(file, ENGINE_FOLDER);
}

// Import sites of `@libsql/client` or the engine folder, type-only included, with no folder exemption.
// Importing the port (`services/storage`) is not debt, so it is not counted.
function engineImportSites(file: string, text?: string): number {
  return importSites(file, text).filter((site) => {
    const target = resolved(file, site.specifier);
    return inArea(target, "@libsql/client") || inArea(target, ENGINE_FOLDER);
  }).length;
}

// Imports of the storage engine from outside the port and the engine. Follow-up: storage port.
function storageImports(file: string): number {
  return inStorage(file) ? 0 : engineImportSites(file);
}

// A string or template literal that starts with an SQL statement keyword, case-sensitive.
// scanLiterals skips comments, so SQL in a comment does not count. Lower-case or
// concatenated SQL is missed; the ratchet only stops the common form from growing.
// A case-insensitive match gave false hits such as "Delete turns failed".
const SQL_STATEMENT =
  /^\s*(?:SELECT\s|INSERT\s+(?:OR\s+\w+\s+)?INTO\s|UPDATE\s+\w+\s+SET\s|DELETE\s+FROM\s|CREATE\s+(?:TABLE|INDEX|UNIQUE|VIRTUAL|TRIGGER)\s|ALTER\s+TABLE\s|DROP\s+(?:TABLE|INDEX)\s|PRAGMA\s|WITH\s+\w+|BEGIN\b|COMMIT\b|ROLLBACK\b|VACUUM\b)/;

// SQL statement literals in a file, with no folder exemption.
function sqlSites(file: string): number {
  const { literals } = scanLiterals(readFileSync(join(srcRoot, file), "utf8"));
  return literals.filter((literal) => SQL_STATEMENT.test(literal.own)).length;
}

// Raw SQL outside the port and the engine. Follow-up: storage port.
function rawSql(file: string): number {
  return inStorage(file) ? 0 : sqlSites(file);
}

// Non-type import sites of src/config.ts per file, recorded after modular-boundaries.
// Guards the config-injection follow-up: new core and services code takes config as an argument.
const configBaseline: Record<string, number> = {
  "src/services/storage/active-space-access.ts": 1,
  "src/services/web-server.ts": 1,
};

// Import sites of @libsql/client or the engine folder per file, type-only included.
// Guards the storage-port follow-up: new code reaches storage through the port, not the engine.
const storageBaseline: Record<string, number> = {
  "src/importer/importer.ts": 2,
  "src/importer/opencode-snapshot.ts": 1,
  "src/importer/settings-health.ts": 1,
  "src/importer/web-import-profile-estimate.ts": 1,
  "src/services/api/shards.ts": 6,
  "src/services/chat/chat-runtime.ts": 2,
  "src/services/cleanup-service.ts": 4,
  "src/services/client-session-read.ts": 3,
  "src/services/client.ts": 7,
  "src/services/deduplication-service.ts": 5,
  "src/services/embedding-change.ts": 1,
  "src/services/linked-search.ts": 2,
  "src/services/live-captured-entries.ts": 2,
  "src/services/memorisation-store.ts": 3,
  "src/services/memory-portability-service.ts": 7,
  "src/services/memory-replace.ts": 4,
  "src/services/migration-service.ts": 8,
  "src/services/retrieval-rerank.ts": 1,
  "src/services/shard-inventory-service.ts": 5,
  "src/services/shard-path-migration-service.ts": 6,
  "src/services/skill-learning/activity.ts": 1,
  "src/services/skill-learning/draft-turns.ts": 1,
  "src/services/skill-learning/ranking.ts": 1,
  "src/services/spaces/backup.ts": 1,
  "src/services/spaces/import-space.ts": 2,
  "src/services/spaces/space-store.ts": 5,
  "src/services/spaces/transfer-service.ts": 4,
  "src/services/spaces/transfer.ts": 1,
  "src/services/tag-migration.ts": 5,
  "src/services/tag-prefix-migration.ts": 5,
  "src/services/tag-prefix-scan.ts": 3,
  "src/services/user-profile/auto-cleanup-store.ts": 2,
  "src/services/user-profile/category-cleanup-store.ts": 2,
  "src/services/user-profile/profile-store.ts": 1,
  "src/services/user-profile/user-profile-manager.ts": 1,
  "src/services/user-prompt/profile-catch-up-lease.ts": 3,
  "src/services/user-prompt/user-prompt-manager.ts": 3,
  "src/services/web-memory-rows.ts": 4,
  "src/services/write-health-checks.ts": 1,
  "src/v2/startup.ts": 2,
};

// SQL statement literals per file, by the SQL_STATEMENT method above.
// Guards the storage-port follow-up: new SQL goes into the port or the engine folder.
const sqlBaseline: Record<string, number> = {
  "src/importer/importer.ts": 1,
  "src/importer/opencode-reader.ts": 8,
  "src/importer/opencode-v2-units.ts": 1,
  "src/importer/settings-health.ts": 1,
  "src/importer/web-import-profile-estimate.ts": 2,
  "src/services/chat/chat-runtime.ts": 1,
  "src/services/cleanup-service.ts": 2,
  "src/services/deduplication-service.ts": 1,
  "src/services/linked-search.ts": 3,
  "src/services/live-captured-entries.ts": 1,
  "src/services/memorisation-store.ts": 1,
  "src/services/memory-portability-service.ts": 1,
  "src/services/memory-replace.ts": 1,
  "src/services/migration-service.ts": 4,
  "src/services/shard-path-migration-service.ts": 1,
  "src/services/skill-learning/agent-proposals.ts": 1,
  "src/services/skill-learning/draft-turns.ts": 3,
  "src/services/skill-learning/failures.ts": 6,
  "src/services/skill-learning/ranking.ts": 2,
  "src/services/skill-learning/turn-summaries.ts": 6,
  "src/services/spaces/backup.ts": 2,
  "src/services/spaces/export-space.ts": 3,
  "src/services/spaces/import-space.ts": 1,
  "src/services/spaces/space-store.ts": 5,
  "src/services/spaces/transfer-service.ts": 7,
  "src/services/tag-migration.ts": 3,
  "src/services/tag-prefix-migration.ts": 9,
  "src/services/tag-prefix-scan.ts": 1,
  "src/services/user-profile/auto-cleanup-store.ts": 8,
  "src/services/user-profile/category-cleanup-store.ts": 10,
  "src/services/user-profile/profile-history.ts": 4,
  "src/services/user-profile/profile-store.ts": 14,
  "src/services/user-prompt/user-prompt-manager.ts": 39,
  "src/services/web-memory-rows.ts": 1,
  "src/services/write-health-checks.ts": 1,
};

const files = tsFiles(".");

function ratchet(
  name: string,
  count: (file: string) => number,
  baseline: Record<string, number>,
  minimum?: number
): void {
  const counts = new Map<string, number>();
  for (const file of files) {
    const found = count(file);
    if (found > 0) counts.set(`src/${file}`, found);
  }

  describe(`${name} ratchet`, () => {
    // The storage ratchets have no file floor: the baseline ends empty. They use the positive control below.
    if (minimum !== undefined) {
      it("scans the source tree", () => {
        // Guards the scanner: a scan that finds nothing would pass every check below.
        expect(counts.size).toBeGreaterThanOrEqual(minimum);
      });
    }

    it("finds none in files outside the baseline", () => {
      const offenders = [...counts]
        .filter(([path]) => !(path in baseline))
        .map(([path, found]) => `${path}: ${found}`);
      expect(offenders).toEqual([]);
    });

    it("does not let a listed file grow", () => {
      const grown = Object.entries(baseline)
        .filter(([path, allowed]) => (counts.get(path) ?? 0) > allowed)
        .map(([path, allowed]) => `${path}: ${counts.get(path)}, allowed ${allowed}`);
      expect(grown).toEqual([]);
    });

    it("drops baseline entries for files that reach 0", () => {
      const stale = Object.keys(baseline).filter((path) => !counts.has(path));
      expect(stale).toEqual([]);
    });

    it("lowers the baseline when a listed file shrinks", () => {
      // Otherwise the file could later grow back to its old count with no failure.
      const shrunk = Object.entries(baseline)
        .filter(([path, allowed]) => counts.has(path) && counts.get(path)! < allowed)
        .map(([path]) => `${path}: lower the baseline to ${counts.get(path)}`);
      expect(shrunk).toEqual([]);
    });
  });
}

// Part 2 of modularity-follow-ups ends at two files by design (D5a): web-server.ts and active-space-access.ts.
ratchet("CONFIG import", configImports, configBaseline, 2);
ratchet("storage import", storageImports, storageBaseline);
ratchet("raw SQL", rawSql, sqlBaseline);

describe("storage ratchet scanners", () => {
  // The baselines shrink to empty, so a file-count floor cannot guard the scanners. Each counter
  // runs with its folder exemption off on the engine, which holds the SQL and the libSQL imports.
  it("finds raw SQL in the engine folder when the exemption is off", () => {
    const found = tsFiles(ENGINE_FOLDER).reduce((total, file) => total + sqlSites(file), 0);
    expect(found).toBeGreaterThanOrEqual(20);
  });

  it("finds the libSQL import in the engine connection manager", () => {
    const specifiers = importSites(`${ENGINE_FOLDER}/connection-manager.ts`).map(
      (s) => s.specifier
    );
    expect(specifiers).toContain("@libsql/client");
  });

  it("counts libSQL and engine imports but not the port", () => {
    const file = "services/user-profile/x.ts";
    expect(engineImportSites(file, 'import { createClient } from "@libsql/client";')).toBe(1);
    expect(engineImportSites(file, 'import type { Client } from "@libsql/client";')).toBe(1);
    expect(engineImportSites(file, 'import { a } from "../turso/connection-manager.js";')).toBe(1);
    expect(engineImportSites(file, 'import { a } from "../storage/profile-store.js";')).toBe(0);
  });
});

/**
 * The lines of `file` that pass `CONFIG` on: `export { CONFIG } from "./config.js"`,
 * `export * from "./config.js"`, or `export { CONFIG }` after an import. A re-export
 * would let core and services import `CONFIG` past the ratchet above.
 */
function configReexports(file: string, text = readFileSync(join(srcRoot, file), "utf8")): number[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  for (const node of source.statements) {
    if (!ts.isExportDeclaration(node)) continue;
    const from =
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? resolved(file, node.moduleSpecifier.text)
        : undefined;
    const named =
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some((item) => (item.propertyName ?? item.name).text === "CONFIG");
    const passesConfig =
      (from === "config.ts" && (!node.exportClause || named)) || (from === undefined && named);
    if (passesConfig) lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
  }
  return lines;
}

describe("CONFIG re-export", () => {
  it("finds each re-export form and ignores other exports", () => {
    // Guards the scan itself: a scan that finds nothing would pass the check below.
    const file = "utils/cfg.ts";
    expect(configReexports(file, 'export { CONFIG } from "../config.js";')).toEqual([1]);
    expect(configReexports(file, 'export { CONFIG as C } from "../config.js";')).toEqual([1]);
    expect(configReexports(file, 'export * from "../config.js";')).toEqual([1]);
    expect(
      configReexports(file, 'import { CONFIG } from "../config.js";\nexport { CONFIG };')
    ).toEqual([2]);
    expect(
      configReexports(file, 'export { getGlobalConfigSourcePath } from "../config.js";')
    ).toEqual([]);
    expect(configReexports(file, 'export { CONFIG } from "./other.js";')).toEqual([]);
  });

  it("is not re-exported outside src/config.ts", () => {
    const offenders = files
      .filter((file) => file !== "config.ts")
      .flatMap((file) => configReexports(file).map((line) => `src/${file}:${line}`));
    expect(offenders).toEqual([]);
  });
});
