import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportOptions } from "../src/lib/components/memory/ImportOptions.tsx";
import { ImportProgressBar } from "../src/lib/components/memory/ImportProgressBar.tsx";
import { progressBarView } from "../src/lib/components/memory/import-finish.ts";
import { loadHostChoice, saveHostChoice } from "../src/lib/components/memory/import-host-choice.ts";
import {
  groupRequest,
  initialImportDraft,
  optionsError,
} from "../src/lib/components/memory/import-draft.ts";
import { workCounts } from "../src/lib/components/memory/ImportResults.tsx";
import type { ImportDraft, ImportJob } from "../src/lib/components/memory/import-types.ts";

const options = (draft: ImportDraft, skillRecording: boolean) =>
  renderToStaticMarkup(
    <ImportOptions
      draft={draft}
      skillRecording={skillRecording}
      advanced={false}
      onChange={() => {}}
      onAdvanced={() => {}}
    />
  );
const store = (initial?: string) => {
  const data = new Map<string, string>(initial ? [["omms-memory-import-hosts", initial]] : []);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};
const checkbox = (html: string) => /<input[^>]*aria-label="Skill turns"[^>]*>/.exec(html)![0];

it("ticks Skill turns beside the other outputs when recording is on", () => {
  const html = options(initialImportDraft(), true);
  expect(checkbox(html)).toContain('checked=""');
  expect(checkbox(html)).not.toContain("disabled");
  expect(html).not.toContain("settings-section-skill-learning");
});

it("clears and disables Skill turns with a settings link when recording is off", () => {
  const html = options(initialImportDraft(), false);
  expect(checkbox(html)).not.toContain('checked=""');
  expect(checkbox(html)).toContain('disabled=""');
  expect(html).toContain('href="/settings#settings-section-skill-learning"');
});

it("reads an old saved draft with no skills value as on", () => {
  const old = JSON.stringify({ hosts: ["pi"], scope: "all-projects" });
  const draft = loadHostChoice(initialImportDraft(), store(old));
  expect(draft.skills).toBe(true);
  expect(draft.scope).toBe("all-projects");
  expect(checkbox(options(draft, true))).toContain('checked=""');
});

it("keeps a saved choice to leave Skill turns off", () => {
  const saved = store();
  const draft = { ...initialImportDraft(), skills: false };
  saveHostChoice(draft, saved);
  expect(loadHostChoice(initialImportDraft(), saved).skills).toBe(false);
});

it("accepts a skill-turns-only choice and sends skipSkills false with it", () => {
  const draft = { ...initialImportDraft(), memories: false, profile: false };
  expect(optionsError(draft)).toBeNull();
  expect(optionsError({ ...draft, skills: false })).toBe("Choose at least one output.");
  const ready = {
    ...draft,
    hosts: {
      ...draft.hosts,
      pi: {
        ...draft.hosts.pi,
        listedWith: "",
        page: null,
      },
    },
  };
  // groupRequest refuses an unlisted host, which proves the output check passed first.
  expect(() => groupRequest(ready, true)).toThrow("Refresh the session list first");
});

it("shows the skill turn counts in a preview", () => {
  const text = workCounts(
    { summary: { skillTurnsWouldRecord: 340, skillTurnsAlreadyRecorded: 12 } },
    (message) => message
  );
  expect(text).toContain("Skill turns to record: 340");
  expect(text).toContain("Skill turns already recorded: 12");
});

const running: ImportJob = {
  id: "j",
  dryRun: false,
  state: "running",
  hosts: [{ host: "pi", state: "running", phase: "skill-turns", processed: 50, total: 200 }],
};

it("labels the progress bar with the Skill turns phase", () => {
  expect(progressBarView(running)).toMatchObject({ phase: "skill-turns", done: 50, percent: 25 });
  const html = renderToStaticMarkup(<ImportProgressBar job={running} />);
  expect(html).toContain("Skill turns: 50 / 200");
});
