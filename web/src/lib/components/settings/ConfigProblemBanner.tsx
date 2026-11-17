import { Callout } from "$lib/components/skills/Callout";
import { acceptedText } from "$lib/config-problem-view";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import { findCatalogueEntry } from "$lib/settings-catalogue";

/** A problem OMMS recorded while it read a config file. Position or key fields name the cause. */
export type ConfigProblemView = {
  file: string;
  line?: number;
  column?: number;
  /** The key that holds a rejected value. */
  key?: string;
  /** The values that key accepts, as words. */
  accepted?: string;
  /** The switch OMMS turned off because of the rejected value. */
  off?: string;
};

/** A setting's plain name in the page language, or its key when the page has no row for it. */
function settingName(key: string, t: ReturnType<typeof useCatalogueText>): string {
  const entry = findCatalogueEntry(key);
  return entry ? t(entry.name) : key;
}

/** One rejected value: a plain sentence first, then the key, file and line as small text. */
export function ValueProblem({ problem }: { problem: ConfigProblemView }) {
  const t = useCatalogueText();
  const key = problem.key!;
  return (
    <>
      <p>
        {findCatalogueEntry(key)
          ? t("{name} has a value OMMS cannot use.", { name: settingName(key, t) })
          : t("A setting has a value OMMS cannot use.")}{" "}
        {problem.accepted
          ? t("It accepts {accepted}.", { accepted: acceptedText(problem.accepted, t) }) + " "
          : null}
        {problem.off
          ? t("“{name}” is off until you fix it.", { name: settingName(problem.off, t) })
          : t("OMMS uses the default for it until you fix it.")}
      </p>
      <p className="text-xs text-muted-foreground">
        <code dir="ltr">{key}</code>
        {problem.file ? (
          <>
            {" · "}
            <bdi dir="ltr">{problem.file}</bdi>
          </>
        ) : null}
        {problem.line !== undefined ? <> · {t("line {line}", { line: problem.line })}</> : null}
      </p>
    </>
  );
}

/** A file OMMS cannot read: one plain sentence, then the file, line and column once as small text. */
export function FileProblem({ problem }: { problem: ConfigProblemView }) {
  const t = useCatalogueText();
  return (
    <>
      <p>
        {t(
          "Your OMMS settings file has an error, so until you fix it OMMS uses the last settings it could read, or its defaults if it has none."
        )}
      </p>
      {problem.file ? (
        <p className="text-xs text-muted-foreground">
          <bdi dir="ltr">{problem.file}</bdi>
          {problem.line !== undefined ? (
            <>
              {" · "}
              {t("line {line}, column {column}", {
                line: problem.line,
                column: problem.column ?? 1,
              })}
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/**
 * The banner above the Settings cards when OMMS recorded a config problem. A file it cannot read
 * leads with a plain sentence, then names the file, line and column. A rejected value leads with the setting's plain name and says what
 * it accepts, with the key, file and line as small text. `readOnly` is true while the global file
 * cannot be read: the page then turns every Save off and says so.
 */
export function ConfigProblemBanner({
  problems,
  readOnly = false,
}: {
  problems: readonly ConfigProblemView[];
  readOnly?: boolean;
}) {
  const t = useCatalogueText();
  if (problems.length === 0) return null;
  return (
    <Callout tone={readOnly ? "danger" : "warning"} className="min-w-0">
      <p className="font-medium">{t("Problem in your config file")}</p>
      <ul className="min-w-0 space-y-1">
        {problems.map((problem, index) => (
          <li
            key={`${problem.file}-${problem.key ?? ""}-${problem.line ?? index}`}
            className="break-words"
          >
            {problem.key ? <ValueProblem problem={problem} /> : <FileProblem problem={problem} />}
          </li>
        ))}
      </ul>
      <p>
        {readOnly ? (
          <>
            {t("Saving is turned off until the file is fixed.")}{" "}
            {t("The cards below show the last settings OMMS could read.")}{" "}
          </>
        ) : null}
        {t("Fix the file, then reload this page.")}
      </p>
    </Callout>
  );
}
