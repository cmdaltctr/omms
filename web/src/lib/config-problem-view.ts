import type { ConfigProblemView } from "$lib/components/settings/ConfigProblemBanner";

/** A problem as the settings snapshot reports it (`src/services/config-problems.ts`). */
export type SnapshotProblem = {
  kind: "parse" | "value";
  file?: string;
  line?: number;
  column?: number;
  key?: string;
  accepted?: string;
  /** The switch the load turned off because of this value. */
  off?: string;
  message: string;
};

/**
 * The banner's view of the problems in the settings snapshot. A syntax error names the file, line
 * and column; the page words the sentence itself, so it can translate it. The server's English
 * `message` stays for hosts and logs. A rejected value names the key, its line, what it accepts
 * and the switch the load turned off, if any.
 */
export function problemViews(
  problems: readonly SnapshotProblem[] | undefined
): ConfigProblemView[] {
  return (problems ?? []).map((problem) =>
    problem.kind === "value"
      ? {
          file: problem.file ?? "",
          key: problem.key,
          accepted: problem.accepted,
          ...(problem.line === undefined ? {} : { line: problem.line }),
          ...(problem.off ? { off: problem.off } : {}),
        }
      : {
          file: problem.file ?? "",
          line: problem.line,
          column: problem.column,
        }
  );
}

type Translate = (message: string, params?: Record<string, string | number>) => string;

/** Plain, translated words for the accepted values the server sends. Unknown text stays as sent. */
export function acceptedText(accepted: string, t: Translate): string {
  if (accepted === "positive safe integers" || accepted === "whole numbers of 1 or more") {
    return t("whole numbers of 1 or more");
  }
  const range = /^(?:integers|whole numbers|numbers) from (-?[\d.]+) to (-?[\d.]+)$/.exec(accepted);
  if (range) {
    const whole = !accepted.startsWith("numbers");
    return t(whole ? "whole numbers from {min} to {max}" : "numbers from {min} to {max}", {
      min: range[1]!,
      max: range[2]!,
    });
  }
  const words: Record<string, string> = {
    boolean: "true or false",
    "true or false": "true or false",
    "an http:// or https:// URL": "a web address that starts with http:// or https://",
    "a non-empty string": "text that is not empty",
    "an env:// or file:// secret reference": "an env:// or file:// reference",
  };
  return words[accepted] ? t(words[accepted]) : accepted;
}
