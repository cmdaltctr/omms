import { useState } from "react";
import { FileUp, Loader } from "lucide-react";
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
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { fetchAPI } from "$lib/api";
import { useI18n } from "$lib/i18n";
import type { SpaceResult, SpaceRow } from "$lib/spaces-api";

type ImportCounts = {
  projectMemories: number;
  userMemories: number;
  profileItems: number;
  fileProjects: number;
};
type CheckData = {
  counts: ImportCounts;
  /** Every project tag in the file; the merge notice counts these. */
  projects: string[];
  embedding: {
    fileModel: string;
    fileDimensions: number;
    currentModel: string;
    currentDimensions: number;
  };
  /** The English server warning; the dialog builds its localised one from `embedding`. */
  warning?: string;
};
type ImportData = { ok: boolean; spaceId?: string; spaceName?: string; counts: ImportCounts };

/**
 * The Import dialog: pick an export file, OMMS checks it, then the user names the new space and
 * confirms. The file is parsed in the browser and sent as JSON, so a file that is not JSON never
 * reaches the server. A name that already exists is refused in the dialog before any request.
 * A model difference warns with both models before the confirmation.
 */
export function ImportDialog({
  spaces,
  onImported,
  onClose,
}: {
  /** The page's spaces, so a taken name is refused before any request. */
  spaces: SpaceRow[];
  /** The page reloads its list after an import created a space. */
  onImported: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  /** The parsed export file; the routes take it as JSON, not as an upload. */
  const [doc, setDoc] = useState<unknown | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<CheckData | null>(null);
  const [checkError, setCheckError] = useState("");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ count: number; name: string } | null>(null);

  /** Map a refused import to its sentence; other refusals show the route's own reason. */
  function reason(reply: SpaceResult<unknown>): string {
    if (reply.code === "name-taken") return t("spaces-import-name-taken", { name: name.trim() });
    if (reply.code === "missing-folder") return t("spaces-import-folder-missing");
    return reply.error ?? "";
  }

  async function runCheck(parsed: unknown) {
    setChecking(true);
    setCheckError("");
    const reply = (await fetchAPI<CheckData>("/api/spaces/import/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: parsed }),
    })) as SpaceResult<CheckData>;
    setChecking(false);
    if (reply.success && reply.data) setCheck(reply.data);
    else setCheckError(reason(reply));
  }

  async function pick(picked: File | undefined) {
    if (!picked) return;
    setFile(picked);
    setCheck(null);
    setCheckError("");
    setDoc(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await picked.text());
    } catch {
      setCheckError(t("spaces-import-error-not-json"));
      return;
    }
    setDoc(parsed);
    void runCheck(parsed);
  }

  const taken = name.trim() !== "" && spaces.some((space) => space.name === name.trim());
  const modelMismatch =
    check !== null &&
    (check.embedding.fileModel !== check.embedding.currentModel ||
      check.embedding.fileDimensions !== check.embedding.currentDimensions);
  const canImport =
    doc !== null && check !== null && !taken && name.trim() !== "" && !running && !done;

  async function runImport() {
    if (!doc) return;
    setRunning(true);
    setError("");
    const reply = (await fetchAPI<ImportData>("/api/spaces/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document: doc,
        name: name.trim(),
        ...(folder.trim() ? { retagToProject: folder.trim() } : {}),
      }),
    })) as SpaceResult<ImportData>;
    setRunning(false);
    setConfirmOpen(false);
    if (reply.success && reply.data) {
      setDone({
        count: reply.data.counts.projectMemories + reply.data.counts.userMemories,
        name: reply.data.spaceName ?? name.trim(),
      });
      onImported();
      return;
    }
    setError(reason(reply));
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => (open || running ? undefined : onClose())}>
        <DialogContent>
          {done ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("spaces-import-title")}</DialogTitle>
              </DialogHeader>
              <Callout tone="success">
                <p>
                  <bdi>{t("spaces-import-done", { count: done.count, name: done.name })}</bdi>
                </p>
              </Callout>
              <DialogFooter>
                <Button type="button" onClick={onClose}>
                  {t("spaces-close")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canImport) setConfirmOpen(true);
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("spaces-import-title")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-1">
                <Label htmlFor="space-import-file">{t("spaces-import-file")}</Label>
                <label className="inline-flex">
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="sr-only peer"
                    disabled={checking || running}
                    onChange={(event) => void pick(event.target.files?.[0])}
                  />
                  <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-border px-3 text-ui font-medium hover:bg-interactive-hover peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
                    <FileUp className="size-4" aria-hidden="true" />
                    {t("spaces-import-choose-file")}
                  </span>
                </label>
                {file ? (
                  <p dir="ltr" className="text-xs text-muted-foreground">
                    {file.name}
                  </p>
                ) : null}
              </div>
              {checking ? (
                <p role="status" className="flex items-center gap-2 text-muted-foreground">
                  <Loader className="size-4 animate-spin" aria-hidden="true" />
                  {t("spaces-import-running")}
                </p>
              ) : null}
              {checkError ? <Callout tone="danger">{checkError}</Callout> : null}
              {check ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="space-import-name">{t("spaces-import-name")}</Label>
                    <Input
                      id="space-import-name"
                      value={name}
                      disabled={running}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="space-import-project">{t("spaces-import-project")}</Label>
                    <Input
                      id="space-import-project"
                      value={folder}
                      disabled={running}
                      dir="ltr"
                      onChange={(event) => setFolder(event.target.value)}
                    />
                    <p>
                      {folder.trim()
                        ? t("spaces-import-projects-merge", {
                            count: check.projects.length,
                            folder: folder.trim(),
                          })
                        : t("spaces-import-projects-kept")}
                    </p>
                  </div>
                  {modelMismatch && check ? (
                    <Callout tone="warning">
                      {t("spaces-import-model-warning", {
                        fileModel: check.embedding.fileModel,
                        fileDimensions: check.embedding.fileDimensions,
                        currentModel: check.embedding.currentModel,
                        currentDimensions: check.embedding.currentDimensions,
                      })}
                    </Callout>
                  ) : null}
                </>
              ) : null}
              {taken ? (
                <Callout tone="danger">
                  {t("spaces-import-name-taken", { name: name.trim() })}
                </Callout>
              ) : null}
              {error ? <Callout tone="danger">{error}</Callout> : null}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={running} onClick={onClose}>
                  {t("spaces-cancel")}
                </Button>
                <Button type="submit" disabled={!canImport}>
                  {t("spaces-import-confirm")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {confirmOpen && canImport ? (
        <Dialog open onOpenChange={(open) => (open || running ? undefined : setConfirmOpen(false))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <bdi>{t("spaces-import-confirm-title", { name: name.trim() })}</bdi>
              </DialogTitle>
              <DialogDescription>
                <bdi>{t("spaces-import-confirm-body", { name: name.trim() })}</bdi>
              </DialogDescription>
            </DialogHeader>
            {running ? (
              <p role="status" className="flex items-center gap-2 text-muted-foreground">
                <Loader className="size-4 animate-spin" aria-hidden="true" />
                {t("spaces-import-running")}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={running}
                onClick={() => setConfirmOpen(false)}
              >
                {t("spaces-cancel")}
              </Button>
              <Button type="button" disabled={running} onClick={() => void runImport()}>
                {t("spaces-import-confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
