import { useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";
import { skillsApi, type FolderRow, type Proposal, type SkillIdea } from "$lib/skills-api";
import { DraftNotice, useDraftNotice } from "./DraftNotice";
import { ProposalCard } from "./ProposalCard";

function IdeaCard({
  idea,
  folders,
  onDrafted,
}: {
  idea: SkillIdea;
  folders: FolderRow[];
  onDrafted: () => void;
}) {
  const s = useSettingsText();
  const [folder, setFolder] = useState(folders[0]?.path ?? "");
  const [busy, setBusy] = useState(false);
  const [drafted, setDrafted] = useState<Proposal | null>(null);
  const notice = useDraftNotice();

  async function draft() {
    setBusy(true);
    notice.clear();
    const reply = await skillsApi.draftNew(idea, folder);
    setBusy(false);
    notice.show(reply);
    if (reply.ok && reply.data.proposal) {
      setDrafted(reply.data.proposal);
      onDrafted();
    }
  }

  return (
    <li className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="space-y-1">
        <h3 className="break-words text-sm font-semibold">{idea.name}</h3>
        <p className="text-sm" dir="auto">
          {idea.description}
        </p>
        {idea.reason ? (
          <p className="text-xs text-muted-foreground" dir="auto">
            {idea.reason}
          </p>
        ) : null}
        {idea.evidenceTurnIds.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {s("Evidence turns")}:{" "}
            <bdi dir="ltr">{idea.evidenceTurnIds.map((id) => `T${id}`).join(", ")}</bdi>
          </p>
        ) : null}
      </div>
      {drafted ? (
        <ProposalCard proposal={drafted} onChange={setDrafted} />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 max-w-full space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">
              {s("Folder for the new skill")}
            </span>
            <Select
              value={folder}
              disabled={busy}
              aria-label={s("Folder for the new skill")}
              onChange={(event) => setFolder(event.target.value)}
            >
              {folders.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.path}
                </option>
              ))}
            </Select>
          </label>
          <Button type="button" size="sm" disabled={busy || !folder} onClick={() => void draft()}>
            <Sparkles aria-hidden="true" />
            {s("Draft skill")}
          </Button>
        </div>
      )}
      <DraftNotice notice={notice.value} />
    </li>
  );
}

/** Find new skill ideas from recorded turns, then draft one into a watched folder. */
export function SkillIdeas({
  folders,
  onDrafted,
}: {
  folders: FolderRow[];
  onDrafted: () => void;
}) {
  const s = useSettingsText();
  const [ideas, setIdeas] = useState<SkillIdea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const notice = useDraftNotice();

  async function find() {
    setBusy(true);
    notice.clear();
    const reply = await skillsApi.ideas();
    setBusy(false);
    notice.show(reply);
    if (reply.ok) setIdeas(reply.data.ideas);
  }

  return (
    <section className="space-y-3" aria-label={s("New skill ideas")}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void find()}
        >
          <Lightbulb aria-hidden="true" />
          {s("Find new skill ideas")}
        </Button>
        {busy ? <span className="text-sm text-muted-foreground">{s("Looking…")}</span> : null}
      </div>
      <DraftNotice notice={notice.value} />
      {ideas && ideas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {s("No new skill ideas in the recorded turns.")}
        </p>
      ) : null}
      {ideas && ideas.length > 0 ? (
        <ul className="space-y-3">
          {ideas.map((idea) => (
            <IdeaCard key={idea.name} idea={idea} folders={folders} onDrafted={onDrafted} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
