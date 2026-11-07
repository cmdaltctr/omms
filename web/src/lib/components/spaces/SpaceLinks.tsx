import { useState } from "react";
import { Link2, Link2Off, Loader } from "lucide-react";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Select } from "$lib/components/ui/select";
import { fetchAPI } from "$lib/api";
import { useI18n } from "$lib/i18n";
import type { SpaceResult, SpaceRow } from "$lib/spaces-api";

export type SpaceLinkRow = { id: string; name: string; available: boolean };

/** The links of a row; the routes add `links` to every space of GET /api/spaces. */
export function linksOf(space: SpaceRow): SpaceLinkRow[] {
  return (space as SpaceRow & { links?: SpaceLinkRow[] }).links ?? [];
}

type Pending = { kind: "link" | "unlink"; id: string; name: string };

/**
 * The linked-spaces section of one card: the linked spaces by name, each with its Unlink button,
 * and a picker that links another space. Every link change asks first through a confirm dialog,
 * and both dialogs say that no memory is copied or deleted. The Default card never shows this
 * section.
 */
export function SpaceLinks({
  space,
  spaces,
  busy,
  onChanged,
}: {
  /** The space whose card holds this section. */
  space: SpaceRow;
  /** Every space of the page, for the picker. */
  spaces: SpaceRow[];
  /** An action is running; every control waits. */
  busy: boolean;
  /** The page reloads its list after a link changed. */
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const links = linksOf(space);
  const linkedIds = new Set(links.map((link) => link.id));
  const candidates = spaces.filter(
    (candidate) => !candidate.archived && candidate.id !== space.id && !linkedIds.has(candidate.id)
  );
  const [pick, setPick] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [unlinked, setUnlinked] = useState<string | null>(null);
  const picked = pick || candidates[0]?.id || "";
  const waiting = busy || running;

  async function change(pendingLink: Pending) {
    setRunning(true);
    setError("");
    const reply = (await fetchAPI<{ ok: boolean }>(`/api/spaces/${space.id}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        pendingLink.kind === "link" ? { add: pendingLink.id } : { remove: pendingLink.id }
      ),
    })) as SpaceResult<{ ok: boolean }>;
    setRunning(false);
    setPending(null);
    if (!reply.success) {
      setError(reply.error ?? "");
      return;
    }
    setPick("");
    if (pendingLink.kind === "unlink") setUnlinked(pendingLink.name);
    onChanged();
  }

  return (
    <div className="space-y-1 text-xs">
      <p className="font-medium">{t("spaces-links-title")}</p>
      {links.length > 0 ? (
        <ul aria-label={t("spaces-links-list-label")} className="space-y-1">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-2">
              <bdi className="min-w-0 break-words">{link.name}</bdi>
              {link.available ? null : <span>{t("spaces-links-unavailable")}</span>}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={waiting}
                aria-label={t("spaces-links-unlink-label", { name: link.name })}
                onClick={() => setPending({ kind: "unlink", id: link.id, name: link.name })}
              >
                <Link2Off aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("spaces-links-none")}</p>
      )}
      {candidates.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            id="space-links-picker"
            value={picked}
            disabled={waiting}
            onChange={(event) => setPick(event.target.value)}
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={waiting || picked === ""}
            onClick={() =>
              setPending({
                kind: "link",
                id: picked,
                name: candidates.find((candidate) => candidate.id === picked)?.name ?? "",
              })
            }
          >
            <Link2 className="size-4" aria-hidden="true" />
            {t("spaces-links-add")}
          </Button>
        </div>
      ) : null}
      {running ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {t("spaces-transfer-applying")}
        </p>
      ) : null}
      {unlinked ? (
        <Callout tone="success">
          <p>
            <bdi>{t("spaces-links-unlinked", { name: unlinked })}</bdi>
          </p>
        </Callout>
      ) : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {pending ? (
        <Dialog open onOpenChange={(open) => (open || running ? undefined : setPending(null))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <bdi>
                  {pending.kind === "link"
                    ? t("spaces-links-confirm-link-title", {
                        name: pending.name,
                        space: space.name,
                      })
                    : t("spaces-links-confirm-unlink-title", { name: pending.name })}
                </bdi>
              </DialogTitle>
              <DialogDescription>
                <bdi>
                  {pending.kind === "link"
                    ? t("spaces-links-confirm-link-body", { name: pending.name, space: space.name })
                    : t("spaces-links-confirm-unlink-body")}
                </bdi>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={running}
                onClick={() => setPending(null)}
              >
                {t("spaces-cancel")}
              </Button>
              <Button type="button" disabled={running} onClick={() => void change(pending)}>
                {pending.kind === "link"
                  ? t("spaces-links-confirm-link-button")
                  : t("spaces-links-unlink")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
