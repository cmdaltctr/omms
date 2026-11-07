import { useState } from "react";
import { Loader } from "lucide-react";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";
import type { SpaceResult, SpaceRow } from "$lib/spaces-api";

export type ExportCounts = {
  projectMemories: number;
  userMemories: number;
  privateSkipped: number;
  profileItems: number;
  pathsReplaced: number;
  emailsReplaced: number;
};
type ExportData = {
  written: boolean;
  /** Carried by the `x-omms-export-info` header of the download response. */
  counts?: ExportCounts;
  warnings: string[];
  /** The downloaded bytes, kept so the dialog can offer the file again. */
  blob?: Blob;
  fileName?: string;
};

/** Offer the export bytes as a browser download. Outside the browser this does nothing. */
function saveBlob(blob: Blob, fileName: string) {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The Export dialog of one card: a date range and the profile opt-in, which stays unticked.
 * A written export comes back as the file bytes themselves, named by `content-disposition`,
 * with counts and warnings in `x-omms-export-info`; an empty selection comes back as JSON.
 * The server replaces home paths and email addresses in the file and reports how many.
 */
export function ExportDialog({ space, onClose }: { space: SpaceRow; onClose: () => void }) {
  const { t } = useI18n();
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [includeProfile, setIncludeProfile] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportData | null>(null);

  async function download() {
    setRunning(true);
    setError("");
    try {
      // The reply can be raw file bytes, so this one call cannot go through `fetchAPI`.
      const response = await fetch(`/api/spaces/${space.id}/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-omms-token": window.__OMMS_TOKEN__ || "",
        },
        body: JSON.stringify({
          ...(since ? { since } : {}),
          ...(until ? { until } : {}),
          includeProfile,
        }),
      });
      const disposition = response.headers.get("content-disposition");
      if (response.ok && disposition) {
        const fileName =
          /filename="([^"]+)"/.exec(disposition)?.[1] ?? `omms-space-export-${space.id}.json`;
        const info = JSON.parse(response.headers.get("x-omms-export-info") ?? "{}") as {
          counts?: ExportCounts;
          warnings?: string[];
        };
        const blob = await response.blob();
        setResult({
          written: true,
          counts: info.counts,
          warnings: info.warnings ?? [],
          blob,
          fileName,
        });
        saveBlob(blob, fileName);
        return;
      }
      const reply = (await response.json().catch(() => null)) as SpaceResult<{
        written: false;
        reason: string;
      }> | null;
      if (reply?.success && reply.data) {
        setResult({ written: false, warnings: [] });
        return;
      }
      setError(reply?.error ?? `Export failed (${response.status}).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }

  const reDownload = () => {
    if (result?.blob && result.fileName) saveBlob(result.blob, result.fileName);
  };

  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : onClose())}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!running) void download();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              <bdi>{t("spaces-export-title", { name: space.name })}</bdi>
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="space-export-since">{t("spaces-export-from")}</Label>
              <Input
                id="space-export-since"
                type="date"
                value={since}
                disabled={running}
                onChange={(event) => setSince(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="space-export-until">{t("spaces-export-to")}</Label>
              <Input
                id="space-export-until"
                type="date"
                value={until}
                disabled={running}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="space-export-profile"
              checked={includeProfile}
              disabled={running}
              onCheckedChange={(checked) => setIncludeProfile(checked === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="space-export-profile">{t("spaces-export-profile-label")}</Label>
              <p className="text-xs text-muted-foreground">{t("spaces-export-profile-note")}</p>
            </div>
          </div>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          {running ? (
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <Loader className="size-4 animate-spin" aria-hidden="true" />
              {t("spaces-export-running")}
            </p>
          ) : null}
          {result ? (
            result.written ? (
              <Callout tone="success">
                <p>
                  {t("spaces-export-replaced", {
                    paths: result.counts?.pathsReplaced ?? 0,
                    emails: result.counts?.emailsReplaced ?? 0,
                  })}
                </p>
                <p>{t("spaces-export-names-note")}</p>
                {result.warnings.length > 0 ? (
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                    {result.warnings.map((warning) => (
                      <li key={warning} className="break-words">
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Callout>
            ) : (
              <p>{t("spaces-export-empty")}</p>
            )
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={running} onClick={onClose}>
              {t("spaces-close")}
            </Button>
            {result?.written ? (
              <Button type="button" variant="outline" disabled={running} onClick={reDownload}>
                {t("spaces-export-download")}
              </Button>
            ) : null}
            <Button type="submit" disabled={running}>
              {t("spaces-export-download")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
