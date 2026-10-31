import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModeChoiceView } from "../src/lib/components/skills/ModeChoice.tsx";
import { ProposalCard, UndoStopped } from "../src/lib/components/skills/ProposalCard.tsx";
import { RecordPastView } from "../src/lib/components/skills/RecordPast.tsx";
import { SkillFolders } from "../src/lib/components/skills/SkillFolders.tsx";
import { SkillList } from "../src/lib/components/skills/SkillList.tsx";
import { SkillSortChoice } from "../src/lib/components/skills/SkillSortChoice.tsx";
import { SkillsPage } from "../src/lib/components/skills/SkillsView.tsx";
import { SkillLearningCard } from "../src/lib/components/settings/SkillLearningSection.tsx";
import type { Proposal, SkillRow, SkillsOverview } from "../src/lib/skills-api.ts";

const skill = (over: Partial<SkillRow> = {}): SkillRow => ({
  name: "s-web-search",
  path: "/home/u/.agents/skills/s-web-search/SKILL.md",
  notInWatchedFolder: false,
  uses: 12,
  failedTurns: 3,
  attention: 0.29,
  lastUsedAt: Date.UTC(2026, 9, 28),
  mode: "manual",
  suggested: false,
  ...over,
});
const folders = [{ path: "/home/u/.agents/skills", skills: 2, exists: true }];
const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  kind: "improve",
  skillName: "s-web-search",
  skillPath: "/home/u/.agents/skills/s-web-search/SKILL.md",
  content: "new",
  diff: "@@ -1,2 +1,2 @@\n keep\n-old line\n+new line",
  summary: "Tighten the search steps.",
  evidenceTurnIds: [],
  state: "pending",
  appliedBy: null,
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

it("shows the Suggested badge, counts and mode on a ranked row", () => {
  const html = renderToStaticMarkup(
    <SkillList skills={[skill({ suggested: true })]} folders={folders} onOpen={() => {}} />
  );
  expect(html).toContain("Suggested");
  expect(html).toContain("Uses 12");
  expect(html).toContain("Failed turns 3");
  expect(html).toContain("Manual");
  expect(html).toContain("/home/u/.agents/skills");
  const plain = renderToStaticMarkup(
    <SkillList skills={[skill()]} folders={folders} onOpen={() => {}} />
  );
  expect(plain).not.toContain("Suggested");
});

it("colours the Suggested badge with the keyword hue", () => {
  const html = renderToStaticMarkup(
    <SkillList skills={[skill({ suggested: true })]} folders={folders} onOpen={() => {}} />
  );
  expect(html).toMatch(/--keyword-hue:\d+/);
  expect(html).toContain("oklch(0.72 0.14");
});

it("marks a skill outside the watched folders", () => {
  const html = renderToStaticMarkup(
    <SkillList
      skills={[skill({ path: null, notInWatchedFolder: true })]}
      folders={folders}
      onOpen={() => {}}
    />
  );
  expect(html).toContain("Not in a watched folder");
});

it("renders a pending proposal with a coloured line diff, summary, Apply and Reject", () => {
  const html = renderToStaticMarkup(<ProposalCard proposal={proposal()} onChange={() => {}} />);
  expect(html).toContain("pending");
  expect(html).toContain("Tighten the search steps.");
  expect(html).toContain('data-line="del"');
  expect(html).toContain('data-line="add"');
  expect(html).toContain('data-line="hunk"');
  expect(html).toContain("font-mono");
  expect(html).toContain(">Apply<");
  expect(html).toContain(">Reject<");
  expect(html).not.toContain(">Undo<");
});

it("offers Undo, not Apply, on an applied proposal", () => {
  const html = renderToStaticMarkup(
    <ProposalCard
      proposal={proposal({ state: "applied", appliedBy: "person" })}
      onChange={() => {}}
    />
  );
  expect(html).toContain(">applied<");
  expect(html).toContain(">Undo<");
  expect(html).not.toContain(">Apply<");
});

it("names each proposal state", () => {
  const label = (state: Proposal["state"], appliedBy: Proposal["appliedBy"] = null) =>
    renderToStaticMarkup(
      <ProposalCard proposal={proposal({ state, appliedBy })} onChange={() => {}} />
    );
  expect(label("applied", "automatic")).toContain("applied automatically");
  expect(label("rejected")).toContain(">rejected<");
  expect(label("undone")).toContain(">undone<");
  const stale = label("stale");
  expect(stale).toContain(">stale<");
  expect(stale).toContain("Stale: the file changed since this draft");
});

it("shows the saved content when undo is refused", () => {
  const html = renderToStaticMarkup(<UndoStopped savedContent={"previous file\nbody"} />);
  expect(html).toContain("Undo stopped because the file changed");
  expect(html).toContain("previous file");
});

it("asks before Automatic and shows the warning only while confirming", () => {
  const props = {
    mode: "manual" as const,
    disabled: false,
    onSelect() {},
    onConfirm() {},
    onCancel() {},
  };
  const idle = renderToStaticMarkup(<ModeChoiceView {...props} confirming={false} />);
  expect(idle).not.toContain("without asking");
  const asking = renderToStaticMarkup(<ModeChoiceView {...props} confirming={true} />);
  expect(asking).toContain("OMMS will change this SKILL.md file without asking");
  expect(asking).toContain("Turn on Automatic");
  expect(asking).toContain('aria-checked="true"');
});

it("lists the watched folders with skill counts and a remove button for each", () => {
  const html = renderToStaticMarkup(
    <SkillFolders
      folders={[
        { path: "/a/skills", skills: 2, exists: true },
        { path: "/b/skills", skills: 1, exists: true },
      ]}
      onChanged={() => {}}
    />
  );
  expect(html).toContain("2 skills");
  expect(html).toContain("1 skill<");
  expect(html).toContain("Remove folder /a/skills");
  expect(html).toContain("Add folder");
});

const overview = (recording: boolean): SkillsOverview => ({
  recording,
  skills: [skill()],
  folders,
});
const page = (o: SkillsOverview | null, turns: number | null, recent: Proposal[] = []) =>
  renderToStaticMarkup(
    <SkillsPage
      overview={o}
      turns={turns}
      pending={[]}
      recent={recent}
      error=""
      query=""
      order="uses"
      onOrder={() => {}}
      onQuery={() => {}}
      onOpen={() => {}}
      onPendingChange={() => {}}
      onRecentChange={() => {}}
      onReload={() => {}}
    />
  );

it("explains an off recording with a link to the settings card, and keeps folders and skills", () => {
  const html = page(overview(false), 0);
  expect(html).toContain("Nothing is recorded yet");
  expect(html).toContain('href="/settings#settings-section-skill-learning"');
  expect(html).toContain("Watched folders");
  expect(html).toContain("s-web-search");
  expect(html).not.toContain("Record past turns");
});

it("offers Record past turns only when recording is on and no turns exist", () => {
  expect(page(overview(true), 0)).toContain("Record past turns");
  expect(page(overview(true), 340)).not.toContain("Record past turns");
  expect(page(overview(true), 340)).not.toContain("Nothing is recorded yet");
  expect(page(overview(true), 340)).toContain("Find new skill ideas");
});

const card = (over: Partial<Parameters<typeof SkillLearningCard>[0]> = {}) =>
  renderToStaticMarkup(
    <SkillLearningCard
      recording={false}
      redact={true}
      projectOff={false}
      stats={{ turns: 340, fileSize: 2048, recording: false, redact: true }}
      busy={false}
      confirm={null}
      message=""
      failure=""
      onRecording={() => {}}
      onRedact={() => {}}
      onConfirm={() => {}}
      onDeleteTurns={() => {}}
      onRecordPastEnd={() => {}}
      {...over}
    />
  );

it("shows both switches, the turn count and the file size", () => {
  const html = card();
  expect(html).toContain("Record agent turns");
  expect(html).toContain("Remove private text and secrets");
  expect(html).toContain(">340<");
  expect(html).toContain("2.0 KB");
  expect(html).toContain("Delete recorded turns");
  expect(html).not.toContain("stores full prompts");
});

it("shows the recording warning and Record past turns when recording is on", () => {
  const html = card({ recording: true });
  expect(html).toContain("OMMS stores full prompts, replies and tool calls in skills.db");
  expect(html).toContain("sends recorded turns to the external API");
  expect(html).toContain("Record past turns");
});

it("shows the danger callout while redaction is off and a question before it turns off", () => {
  const off = card({ redact: false });
  expect(off).toContain('data-tone="danger"');
  expect(off).toContain("will be stored as written and sent to the external API");
  expect(card()).not.toContain('data-tone="danger"');
  const asking = card({ confirm: "redact" });
  expect(asking).toContain("Stop removing private text and secrets?");
  expect(asking).toContain(">Turn off<");
});

it("states the count in the delete confirmation", () => {
  const html = card({ confirm: "delete" });
  expect(html).toContain("Delete 340 recorded turns? This cannot be undone.");
  expect(card({ stats: { turns: 0, fileSize: 0, recording: true, redact: true } })).toContain(
    "disabled"
  );
});

it("shows a sort choice beside the filter, with the current order selected", () => {
  const html = page(overview(true), 340);
  expect(html).toContain("Most used");
  expect(html).toContain("Needs attention");
  const byAttention = renderToStaticMarkup(
    <SkillSortChoice order="attention" onChange={() => {}} />
  );
  expect(byAttention).toMatch(/aria-checked="true"[^>]*>Needs attention/);
  expect(byAttention).toMatch(/aria-checked="false"[^>]*>Most used/);
});

it("shows attention in the meta line of a ranked row", () => {
  const html = renderToStaticMarkup(
    <SkillList skills={[skill({ attention: 0.42 })]} folders={folders} onOpen={() => {}} />
  );
  expect(html).toContain("Attention 0.42");
});

it("lists recent proposals below Pending, folded, with their state and Undo when applied", () => {
  const html = page(overview(true), 3, [
    proposal({ id: "r1", kind: "new", skillName: "deploy", state: "rejected" }),
    proposal({ id: "r2", state: "applied", appliedBy: "person" }),
  ]);
  expect(html).toContain("Recent proposals");
  expect(html).toContain("deploy");
  expect(html).toContain(">rejected<");
  expect(html).toContain("Show changes");
  expect(html).not.toContain("Hide changes");
  expect(html).toContain("Undo");
  expect(page(overview(true), 3)).not.toContain("Recent proposals");
});

it("says Record past turns is finding sessions while it starts, and nothing before a click", () => {
  const view = (starting: boolean) =>
    renderToStaticMarkup(
      <RecordPastView job={null} running={false} starting={starting} error="" onStart={() => {}} />
    );
  expect(view(true)).toContain("Finding past sessions…");
  expect(view(true)).toContain('role="status"');
  expect(view(false)).not.toContain("Finding past sessions…");
});
