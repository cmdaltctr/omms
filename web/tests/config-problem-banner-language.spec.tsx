import { expect, it } from "bun:test";
import { allText, installReact, render } from "./space-kit.tsx";

// The page language comes from a store that server rendering cannot switch, so this renders
// with the fake React of the other card specs.
installReact();
const { ConfigProblemBanner, FileProblem, ValueProblem } =
  await import("../src/lib/components/settings/ConfigProblemBanner.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [ConfigProblemBanner, FileProblem, ValueProblem];
const broken = { file: "~/.config/omms/omms.jsonc", line: 7, column: 3 };

it("words a broken file in the page language, with the file once", () => {
  for (const language of ["zh", "ar"] as const) {
    setLanguage(language);
    const words = allText(render(<ConfigProblemBanner problems={[broken]} readOnly />, own));
    for (const english of ["Your OMMS settings", "OMMS cannot read", "line 7", "column", "Fix"]) {
      expect(words).not.toContain(english);
    }
    expect(words).toContain("7");
    expect(words.split("~/.config/omms/omms.jsonc")).toHaveLength(2);
  }
  setLanguage("en");
});
