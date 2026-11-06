import { useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { SpaceBackups } from "./SpaceBackups";
import { SpaceEditDialog } from "./SpaceEditDialog";
import { SpaceCard, type SpaceCardActions } from "./SpaceCard";
import { SpaceViewToggle, useSpacesLayout } from "./SpaceViewToggle";
import { useSpaceActions } from "@/hooks/useSpaceActions";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";
import { announceSpacesChanged } from "$lib/spaces-store";
import { saveSpaceEdit, spacesApi, type SpaceRow as Space } from "$lib/spaces-api";
import { revealPageAnchor } from "$lib/settings-navigation";

/** Default first, then the other spaces in the order they were created. */
function inCardOrder(spaces: Space[]): Space[] {
  const rank = (space: Space) => (space.id === "default" ? 0 : 1);
  return [...spaces].sort(
    (a, b) => rank(a) - rank(b) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
  );
}

/**
 * The Spaces page: a card for every space that is not archived, a create form and the backups.
 * Archived spaces live on the Archive page.
 */
export function SpacesView() {
  const { t } = useI18n();
  const [layout, setLayout] = useSpacesLayout();
  const { spaces, act, ask, askDelete, setFeedback, dialogs, feedbackFor } = useSpaceActions();
  const { load } = spaces;
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const cards = inCardOrder((spaces.snapshot?.spaces ?? []).filter((space) => !space.archived));
  const editing = cards.find((space) => space.id === editingId) ?? null;
  const loaded = spaces.snapshot !== null;

  useEffect(() => {
    void load();
  }, [load]);

  // A link such as /spaces#space-card-experiments waits for the cards to exist.
  useEffect(() => {
    if (loaded && typeof window !== "undefined") revealPageAnchor(window.location.hash);
  }, [loaded]);

  const actions: SpaceCardActions = {
    onSwitch: ask("switch"),
    onEdit: (space) => setEditingId(space.id),
    onArchive: ask("archive"),
    onBackUp: ask("backup"),
    onDelete: askDelete,
  };

  async function create(event: { preventDefault: () => void }) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const result = await act(
      "spaces",
      t("spaces-creating", { name }),
      () => spacesApi.create(name),
      (data) => ({
        text: t("spaces-created-done", { name: data.space.name }),
        offerSwitch: data.space,
      })
    );
    if (result.success) setNewName("");
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("spaces-intro")}</p>
      {spaces.snapshot?.problem ? (
        <Callout tone="warning">
          <p className="font-medium">{t("spaces-problem")}</p>
          <p>{spaces.snapshot.problem}</p>
        </Callout>
      ) : null}
      {spaces.snapshot?.current.customStoragePath ? (
        <Callout tone="info">{t("spaces-custom-note")}</Callout>
      ) : null}
      {spaces.busy ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {spaces.busy}
        </p>
      ) : null}

      <section aria-labelledby="spaces-create" className="space-y-3">
        <h2 id="spaces-create" className="text-section-title font-semibold text-muted-foreground">
          {t("spaces-create-title")}
        </h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void create(event)}>
          <div className="w-72 min-w-0 max-w-full space-y-1">
            <Label htmlFor="space-new-name">{t("spaces-create-label")}</Label>
            <Input
              id="space-new-name"
              value={newName}
              placeholder={t("spaces-create-placeholder")}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={spaces.busy !== null || newName.trim() === ""}>
            {t("spaces-create-button")}
          </Button>
        </form>
      </section>

      <section aria-labelledby="spaces-list" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="spaces-list" className="text-section-title font-semibold text-muted-foreground">
            {t("spaces-list-title")}
          </h2>
          <SpaceViewToggle layout={layout} onChange={setLayout} />
        </div>
        {feedbackFor("spaces")}
        {spaces.loading && !spaces.snapshot ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t("spaces-loading")}
          </p>
        ) : null}
        {!spaces.snapshot && spaces.loadError ? (
          <Callout tone="danger">
            <p>{t("spaces-load-failed")}</p>
            <p>{spaces.loadError}</p>
          </Callout>
        ) : null}
        {spaces.snapshot ? (
          <ul
            aria-label={t("spaces-list-label")}
            className={
              layout === "list"
                ? "flex flex-col gap-3"
                : "grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2"
            }
          >
            {cards.map((space) => (
              <SpaceCard
                key={space.id}
                layout={layout}
                space={space}
                busy={spaces.busy !== null}
                actions={actions}
              />
            ))}
          </ul>
        ) : null}
      </section>

      {spaces.snapshot ? (
        <section aria-labelledby="spaces-backups" className="space-y-3">
          <h2
            id="spaces-backups"
            className="text-section-title font-semibold text-muted-foreground"
          >
            {t("spaces-backups-title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("spaces-backups-intro")}</p>
          {feedbackFor("backups")}
          <SpaceBackups
            backups={spaces.snapshot.backups}
            busy={spaces.busy !== null}
            onRestore={(backup) =>
              void act(
                "backups",
                t("spaces-restoring", { name: backup.spaceName }),
                () => spacesApi.restore(backup.folder),
                (data) => ({ text: t("spaces-restored", { name: data.space.name }) })
              )
            }
          />
        </section>
      ) : null}

      {editing ? (
        <SpaceEditDialog
          key={editing.id}
          space={editing}
          onClose={() => setEditingId(null)}
          onSave={async (name, change) => {
            const result = await spaces.run(t("spaces-saving", { name: editing.name }), () =>
              saveSpaceEdit(editing.id, { name, change })
            );
            if (!result.success) {
              // A rename that went through must show, even though the look then failed.
              if (result.data?.renamed) {
                await spaces.load();
                announceSpacesChanged();
              }
              throw new Error(result.error ?? "");
            }
            setFeedback({
              where: "spaces",
              tone: "success",
              text: t("spaces-saved", { name: name ?? editing.name }),
            });
          }}
        />
      ) : null}
      {dialogs}
    </div>
  );
}
