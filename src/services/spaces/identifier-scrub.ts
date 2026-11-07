import { stripPrivateContent } from "../privacy.js";

/**
 * Replacement counts for one scrubbed string, so an export can report how
 * much it changed.
 */
export interface ScrubCounts {
  /** Home-folder paths rewritten to the `~` form. */
  readonly pathsReplaced: number;
  /** Email addresses rewritten to `<email>`. */
  readonly emailsReplaced: number;
}

/** The scrubbed string plus what the scrubber replaced in it. */
export interface ScrubResult {
  readonly text: string;
  readonly counts: ScrubCounts;
}

// Characters that end a path token in free text. A path cut at one of them
// still loses its user name, which is the part that identifies a person.
const STOP = "\\s\"'`<>()[\\]{},;:!?";
// `/Users/<name>/...` (macOS) and `/home/<name>/...` (Linux). The lookbehind
// keeps the path part of a URL (`example.com/home/jo`) out of the match.
const POSIX_HOME = new RegExp(`(?<!\\w)\\/(?:Users|home)\\/([^/${STOP}]+)([^${STOP}]*)`, "g");
// `<drive>:\Users\<name>\...` (Windows), any drive letter, either separator.
const WINDOWS_HOME = new RegExp(
  `(?<!\\w)[a-z]:[\\\\/]users[\\\\/]([^\\\\/${STOP}]+)([^${STOP}]*)`,
  "gi"
);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Replace the parts of a string that identify a person: home-folder paths
 * become `~` plus the rest of the path, email addresses become `<email>`,
 * and `<private>` regions go first (via `stripPrivateContent`), so anything
 * inside them is neither kept nor counted.
 *
 * Deliberately narrow: system paths (`/usr/local`) and URLs stay, because
 * memories often quote them. The exporter scans the finished file and fails
 * the export when an identifier survives anyway.
 */
export function scrubIdentifiers(text: string): ScrubResult {
  const withoutPrivate = stripPrivateContent(text);

  // Windows first: its forward-slash form ends in `/Users/...`, which the
  // POSIX pass would otherwise rewrite and leave a stray `C:~` behind.
  let pathsReplaced = 0;
  const toTilde = (_match: string, _name: string, rest: string): string => {
    pathsReplaced++;
    return `~${rest}`;
  };
  const afterPaths = withoutPrivate.replace(WINDOWS_HOME, toTilde).replace(POSIX_HOME, toTilde);

  let emailsReplaced = 0;
  const scrubbed = afterPaths.replace(EMAIL, () => {
    emailsReplaced++;
    return "<email>";
  });

  return {
    text: scrubbed,
    counts: { pathsReplaced, emailsReplaced },
  };
}
