/**
 * Config problems (openspec change friendly-settings): a config file that
 * cannot be read, or a value that fails validation, becomes a plain-English
 * problem instead of stopping the host. Pure helpers plus one module-level
 * list. Do not import CONFIG here: many tests stub src/config.js, so hosts
 * read problems from this module.
 *
 * A problem never quotes file content or a rejected value: it names the file,
 * the line and column, or the key and the values it accepts.
 */
import { readFileSync } from "node:fs";
import { findNodeAtLocation, parseTree, visit, type ParseErrorCode } from "jsonc-parser";
import { pageCanEdit } from "./settings-editable-keys.js";

export interface ConfigProblem {
  /** `parse`: the file cannot be read. `value`: one key was rejected and uses its default. */
  kind: "parse" | "value";
  /** The config file, when known. */
  file?: string;
  /** 1-based line and column of the first syntax error (`parse` only). */
  line?: number;
  column?: number;
  /** The rejected setting and the values it accepts (`value` only). */
  key?: string;
  accepted?: string;
  /** The switch this load turned off because of the rejected value (`value` only). */
  off?: string;
  /** One plain sentence for the user, ready to show. */
  message: string;
}

/** A config value that failed validation. The message never holds the value. */
export class ConfigValueError extends Error {
  constructor(
    readonly key: string,
    readonly accepted: string
  ) {
    super(`Invalid ${key} config (accepted: ${accepted})`);
    this.name = "ConfigValueError";
  }
}

/** A config file that cannot be parsed during a live reload. */
export class ConfigFileError extends Error {
  constructor(
    file: string,
    readonly problem: ConfigProblem,
    cause?: unknown
  ) {
    super(`Config file cannot be parsed: ${file}`, { cause });
    this.name = "ConfigFileError";
  }
}

const FIX = "Fix the file or open the Settings page.";
const FIX_FILE = "Fix the file.";

/**
 * Keys whose rejected value turns a feature off for this load, instead of using the default.
 * The default here would delete memories, call a paid model or start the web app at login, and
 * the user may have written the value to stop that. Maps each key to the switch set to false.
 */
const FAIL_SAFE: Readonly<Record<string, { off: string; feature: string }>> = {
  autoDeleteOldMemories: { off: "autoDeleteOldMemories", feature: "Automatic memory deletion" },
  autoCleanupRetentionDays: { off: "autoDeleteOldMemories", feature: "Automatic memory deletion" },
  autoBackfill: { off: "autoBackfill", feature: "Automatic import of past chats" },
  opencodeBackfillModel: { off: "autoBackfill", feature: "Automatic import of past chats" },
  piBackfillModel: { off: "autoBackfill", feature: "Automatic import of past chats" },
  autoCaptureEnabled: { off: "autoCaptureEnabled", feature: "Automatic memory capture" },
  userProfileAutoCleanupEnabled: {
    off: "userProfileAutoCleanupEnabled",
    feature: "Automatic profile tidying",
  },
  userProfileAutoCleanupInterval: {
    off: "userProfileAutoCleanupEnabled",
    feature: "Automatic profile tidying",
  },
  webServerAutoStart: { off: "webServerAutoStart", feature: "Starting the web app at login" },
};

/** Switches the config build accepts only as true or false, so text such as "false" is rejected. */
export const STRICT_BOOLEANS = [
  "autoBackfill",
  "webServerAutoStart",
  "autoDeleteOldMemories",
  "autoCaptureEnabled",
  "userProfileAutoCleanupEnabled",
] as const;

// jsonc-parser's ParseErrorCode values (a const enum, so spelt out here).
const SENTENCES: Partial<Record<ParseErrorCode, string>> = {
  1: "there is a character OMMS does not expect",
  2: "a number is not written correctly",
  3: "a setting name in double quotes is expected",
  4: "a value is missing",
  5: "a colon is missing after a setting name",
  6: "a comma is missing",
  7: "a closing } is missing",
  8: "a closing ] is missing",
  9: "there is text after the end of the settings",
  10: "a comment is not written correctly",
  11: "a comment is not closed with */",
  12: "a text value is not closed with a double quote",
  14: "a \\u code in a text value is not valid",
  15: "a backslash in a text value is not valid",
  16: "a text value holds a character that is not allowed",
};

function lineAndColumn(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

/**
 * Describe why `content` is not valid JSONC. Call only after the normal parse
 * failed. `onReload` says the running host keeps its last good settings;
 * otherwise it uses the defaults. `content` is undefined when the file could
 * not be opened.
 */
export function describeJsoncError(
  file: string,
  content: string | undefined,
  onReload: boolean
): ConfigProblem {
  const uses = onReload
    ? "OMMS keeps the last settings it could read until then."
    : "OMMS uses its default settings until then.";
  if (content === undefined) {
    return { kind: "parse", file, message: `OMMS cannot open ${file}. ${FIX_FILE} ${uses}` };
  }
  let first: { code: ParseErrorCode; offset: number } | undefined;
  let lastTokenEnd = 0;
  const token = (offset: number, length: number) => {
    if (!first) lastTokenEnd = offset + length;
  };
  visit(
    content,
    {
      onObjectBegin: token,
      onObjectEnd: token,
      onArrayBegin: token,
      onArrayEnd: token,
      onObjectProperty: (_name, offset, length) => token(offset, length),
      onLiteralValue: (_value, offset, length) => token(offset, length),
      onSeparator: (_char, offset, length) => token(offset, length),
      onError: (code, offset) => {
        first ??= { code, offset };
      },
    },
    { allowTrailingComma: true, disallowComments: false }
  );
  if (!first) {
    return { kind: "parse", file, message: `OMMS cannot read ${file}. ${FIX_FILE} ${uses}` };
  }
  // A missing comma is reported at the next token; point at the end of the line before it.
  const offset = first.code === 6 ? lastTokenEnd : first.offset;
  const { line, column } = lineAndColumn(content, offset);
  const sentence = SENTENCES[first.code] ?? "the text cannot be read";
  return {
    kind: "parse",
    file,
    line,
    column,
    message: `OMMS cannot read ${file}: on line ${line}, column ${column}, ${sentence}. ${FIX_FILE} ${uses}`,
  };
}

/**
 * The key and accepted values of a rejected config value: a ConfigValueError,
 * or a plain "Invalid <key> config" error from another validator.
 */
function rejectedKey(error: unknown): { key: string; accepted?: string } | undefined {
  if (error instanceof ConfigValueError) return { key: error.key, accepted: error.accepted };
  if (!(error instanceof Error)) return undefined;
  const match = /^Invalid ([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)?) config\b/.exec(
    error.message
  );
  if (!match) return undefined;
  // Other validators write "Invalid <key> config (accepted: <values>)".
  const accepted = /\(accepted: ([^)]+)\)$/.exec(error.message)?.[1];
  return { key: match[1]!, accepted };
}

/** The problem for a rejected value, or undefined when the error names no key. */
export function valueProblem(
  error: unknown,
  file: string | undefined,
  onReload: boolean
): ConfigProblem | undefined {
  const rejected = rejectedKey(error);
  return rejected && keyProblem(rejected.key, rejected.accepted, file, onReload);
}

/** The 1-based line of `key` in `file`, or undefined when the file or the key cannot be found. */
function lineOfKey(file: string | undefined, key: string): number | undefined {
  if (!file) return undefined;
  try {
    const content = readFileSync(file, "utf8");
    const node = findNodeAtLocation(parseTree(content) ?? ({} as never), key.split("."));
    const at = node?.parent?.offset;
    return at === undefined ? undefined : lineAndColumn(content, at).line;
  } catch {
    return undefined;
  }
}

function keyProblem(
  key: string,
  accepted: string | undefined,
  file: string | undefined,
  onReload: boolean
): ConfigProblem {
  const line = lineOfKey(file, key);
  const where = file ? `${key} in ${file}${line ? ` on line ${line}` : ""}` : key;
  const range = accepted ? ` It accepts ${accepted}.` : "";
  const safe = FAIL_SAFE[key];
  const uses = safe
    ? `${safe.feature} is off until then.`
    : onReload
      ? "OMMS keeps the last settings it could read until then."
      : `OMMS uses the default for ${key} until then.`;
  return {
    kind: "value",
    file,
    line,
    key,
    accepted,
    ...(safe ? { off: safe.off } : {}),
    message: `${where} has a value OMMS cannot use.${range} ${pageCanEdit(key) ? FIX : FIX_FILE} ${uses}`,
  };
}

function withoutKey<C extends object>(config: C, key: string): C {
  const copy = structuredClone(config) as Record<string, unknown>;
  const [head, leaf] = key.split(".") as [string, string | undefined];
  const parent = copy[head];
  if (leaf && parent && typeof parent === "object")
    delete (parent as Record<string, unknown>)[leaf];
  else delete copy[head];
  return copy as C;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The top-level key whose removal stops `error`, for a validator whose message
 * names no key (a missing secret file, the memorisation size pair).
 */
function culpritKey<C extends object, T>(
  build: (config: C) => T,
  config: C,
  error: unknown
): string | undefined {
  // Running the web app without its password would open it to anyone who can reach it.
  return Object.keys(config).find((key) => {
    if (key === "webServerAuthPassword") return false;
    try {
      build(withoutKey(config, key));
      return true;
    } catch (other) {
      return messageOf(other) !== messageOf(error);
    }
  });
}

/**
 * Call `build`. When it rejects one value, drop that key from a copy, record
 * a problem and try again, at most once per key. A fail-safe key also sets its
 * switch to false in the copy. When no key explains the error, the error is
 * thrown as before. A first load and a live reload both use this; only a file
 * that cannot be parsed keeps the last good settings on reload.
 * `fileConfig` in the result is the copy that built.
 */
export function buildTolerant<C extends object, T>(
  build: (config: C) => T,
  fileConfig: C,
  fileOf: (key: string) => string | undefined
): { config: T; fileConfig: C; problems: ConfigProblem[] } {
  const problems: ConfigProblem[] = [];
  let current = fileConfig;
  for (;;) {
    try {
      return { config: build(current), fileConfig: current, problems };
    } catch (error) {
      const rejected = rejectedKey(error);
      const key = rejected?.key ?? culpritKey(build, current, error);
      if (!key || problems.some((problem) => problem.key === key)) throw error;
      problems.push(keyProblem(key, rejected?.accepted, fileOf(key), false));
      current = withoutKey(current, key);
      const off = FAIL_SAFE[key]?.off;
      if (off) current = { ...current, [off]: false };
    }
  }
}

/**
 * Build `config` after dropping every rejected key outside `keep`, so only a bad value under one
 * of the `keep` keys throws, with its own message. A Settings save uses it: a bad value the save
 * does not touch must not stop the user from changing another setting.
 */
export function buildKeeping<C extends object, T>(
  build: (config: C) => T,
  config: C,
  keep: readonly string[]
): T {
  const top = (key: string) => key.split(".")[0];
  const kept = new Set(keep.map(top));
  const others = buildTolerant(build, config, () => undefined)
    .problems.map((problem) => problem.key!)
    .filter((key) => !kept.has(top(key)));
  return build(others.reduce(withoutKey, config));
}

/** The problem behind a failed live reload, when the error describes one. */
export function reloadProblem(error: unknown): ConfigProblem | undefined {
  return error instanceof ConfigFileError ? error.problem : valueProblem(error, undefined, true);
}

let problems: readonly ConfigProblem[] = [];

/** Replace the list with the problems of the latest config load. */
export function recordConfigProblems(next: readonly ConfigProblem[]): void {
  problems = [...next];
}

/** The problems of the latest config load; empty when the files are fine. */
export function currentConfigProblems(): readonly ConfigProblem[] {
  return problems;
}
