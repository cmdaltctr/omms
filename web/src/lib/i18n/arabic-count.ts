/**
 * Arabic counted nouns change form with the number: 1 and 2 have their own words, 3 to 10 take
 * the plural, 11 to 99 take the singular with tanween, and 100 takes the plain singular. The
 * one-text-per-key tables cannot hold that, so these messages pick their form here.
 */
type Forms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const FORMS: Readonly<Record<string, Forms>> = {
  "{count} days": {
    one: "يوم واحد",
    two: "يومان",
    few: "{count} أيام",
    many: "{count} يوماً",
    other: "{count} يوم",
  },
  "{count} hours": {
    one: "ساعة واحدة",
    two: "ساعتان",
    few: "{count} ساعات",
    many: "{count} ساعة",
    other: "{count} ساعة",
  },
};

const rules = new Intl.PluralRules("ar");

/** The Arabic text for a counted message, or undefined when the table text applies. */
export function arabicCount(message: string, count: string | number): string | undefined {
  const forms = FORMS[message];
  const value = Number(count);
  if (!forms || !Number.isInteger(value)) return undefined;
  return (forms[rules.select(value)] ?? forms.other).replace("{count}", String(value));
}
