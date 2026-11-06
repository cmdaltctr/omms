import { useState, type ReactNode } from "react";
import { useSpaces } from "@/hooks/useSpaces";
import {
  SpaceConfirmDialog,
  type ConfirmKind,
  type ConfirmRequest,
} from "$lib/components/spaces/SpaceConfirmDialog";
import { SpaceDeleteDialog } from "$lib/components/spaces/SpaceDeleteDialog";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";
import { navigate } from "$lib/router";
import { spacesApi, type SpaceResult, type SpaceRow } from "$lib/spaces-api";
import { ROUTES } from "$lib/routes";

export type Feedback = {
  where: "spaces" | "backups";
  tone: "success" | "danger";
  text: string;
  /** The new space, so the page can offer to activate it. */
  offerSwitch?: { id: string; name: string };
  /** A link to another page, such as the Archive. */
  link?: { href: string; label: string };
};

/**
 * What the Spaces page and the Archive page share: the list, the feedback line, and the dialogs
 * for the actions that ask first (activate, archive, restore, back up) and for delete. A card
 * or a row only opens a dialog. The request goes out when the user confirms.
 */
export function useSpaceActions() {
  const { t } = useI18n();
  const spaces = useSpaces();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [deleting, setDeleting] = useState<SpaceRow | null>(null);

  /** Runs one call. A success becomes the success text, a failure shows the server's reason. */
  async function act<T>(
    where: Feedback["where"],
    working: string,
    call: () => Promise<SpaceResult<T>>,
    done: (data: T) => Omit<Feedback, "where" | "tone">,
    failed = ""
  ) {
    setFeedback(null);
    const result = await spaces.run(working, call);
    setFeedback(
      result.success
        ? { where, tone: "success", ...done(result.data as T) }
        : { where, tone: "danger", text: [failed, result.error ?? ""].filter(Boolean).join(" ") }
    );
    return result;
  }

  /** Runs a confirmed action. The page shows the feedback line, and the dialog shows a failure. */
  function runConfirmed({ kind, id, name }: ConfirmRequest) {
    if (kind === "switch") {
      return act(
        "spaces",
        t("spaces-switching", { name }),
        () => spacesApi.switchTo(id),
        () => ({ text: t("spaces-switched", { name }) }),
        t("spaces-switch-failed")
      );
    }
    if (kind === "archive") {
      return act(
        "spaces",
        t("spaces-archiving", { name }),
        () => spacesApi.archive(id),
        () => ({
          text: t("spaces-archived", { name }),
          link: { href: ROUTES.spacesArchive, label: t("spaces-archive-open") },
        })
      );
    }
    if (kind === "restore") {
      return act(
        "spaces",
        t("spaces-restoring", { name }),
        () => spacesApi.unarchive(id),
        () => ({ text: t("spaces-restored-space", { name }) })
      );
    }
    return act(
      "spaces",
      t("spaces-backing-up", { name }),
      () => spacesApi.backUp(id),
      (data) => ({ text: t("spaces-backed-up", { path: data.backup.path }) })
    );
  }

  const ask = (kind: ConfirmKind) => (space: Pick<SpaceRow, "id" | "name">) =>
    setConfirming({ kind, id: space.id, name: space.name });

  const dialogs = (
    <>
      {confirming ? (
        <SpaceConfirmDialog
          request={confirming}
          onClose={() => setConfirming(null)}
          onConfirm={runConfirmed}
        />
      ) : null}
      <SpaceDeleteDialog
        space={deleting}
        onClose={() => setDeleting(null)}
        onDelete={(space, confirmName) =>
          spaces.run(t("spaces-deleting", { name: space.name }), () =>
            spacesApi.remove(space.id, confirmName)
          )
        }
      />
    </>
  );

  /** The feedback line for one section, with its link or its offer to activate a new space. */
  const feedbackFor = (where: Feedback["where"]): ReactNode =>
    feedback?.where === where ? (
      <div aria-live="polite" className="space-y-2">
        <Callout tone={feedback.tone === "success" ? "success" : "danger"}>{feedback.text}</Callout>
        {feedback.link ? (
          <a
            href={feedback.link.href}
            onClick={(event) => {
              event.preventDefault();
              navigate(feedback.link!.href);
            }}
            className="text-ui text-primary-label underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {feedback.link.label}
          </a>
        ) : null}
        {feedback.offerSwitch ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={spaces.busy !== null}
            onClick={() => ask("switch")(feedback.offerSwitch!)}
          >
            {t("spaces-created-switch", { name: feedback.offerSwitch.name })}
          </Button>
        ) : null}
      </div>
    ) : null;

  return { spaces, act, ask, askDelete: setDeleting, setFeedback, dialogs, feedbackFor };
}
