import { useEffect, useState, type ReactNode } from "react";
import { Loader, Sparkles } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { InfoPopover } from "$lib/components/ui/info-popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { navigate, ROUTES } from "$lib/router";
import { useSettingsText } from "$lib/i18n/settings";
import {
  skillsApi,
  type ExplainCauseKind,
  type FailureExplanation,
  type FailureGroup,
  type SkillRow,
} from "$lib/skills-api";
import { Callout } from "./Callout";

const CONFIRM_KEY = "omms-explain-failures-confirmed";

/** The confirmation is a browser convenience; a browser without storage asks again every time. */
function confirmedBefore(): boolean {
  try {
    return window.localStorage.getItem(CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberConfirmation(): void {
  try {
    window.localStorage.setItem(CONFIRM_KEY, "1");
  } catch {
    // Without storage the confirmation is asked again next time.
  }
}

/** One warning text for both places: the first-use confirmation and the "i" popover (design §11). */
export function warningParagraphs(s: (message: string) => string, redact: boolean): ReactNode[] {
  return [
    <p key="what">
      {s(
        "This sends the failure groups (tool names, error text and input excerpts of up to 500 characters) and this skill's SKILL.md to the external API model."
      )}
    </p>,
    redact ? (
      <p key="redact">
        {s("The text is sent as stored, after <private> removal and secret redaction.")}
      </p>
    ) : (
      <p key="no-redact">
        {s("Warning: redaction is off. The text may hold secrets that were not removed.")}
      </p>
    ),
  ];
}

/** The label a cause carries in the panel; each is a lead, not a verdict. */
export function causeLabel(s: (message: string) => string, kind: ExplainCauseKind): string {
  switch (kind) {
    case "skill":
      return s("Skill fix");
    case "harness":
      return s("Host or harness bug");
    case "environment":
      return s("Environment problem");
    default:
      return s("Unknown");
  }
}

function CauseCard({ cause }: { cause: FailureExplanation["causes"][number] }) {
  const s = useSettingsText();
  return (
    <li className="space-y-1.5 rounded-xl border border-border bg-card px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">{causeLabel(s, cause.kind)}</p>
      <p className="break-words text-sm" dir="auto">
        {cause.explanation}
      </p>
      {cause.actions.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">{s("Suggested actions")}</p>
          <ul className="list-disc space-y-0.5 ps-5 text-sm">
            {cause.actions.map((action, index) => (
              <li key={index} dir="auto">
                {action}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

/**
 * The **Explain failures** control of the Failures section. Sends the skill's
 * failure groups and its `SKILL.md` to the external API model and shows the
 * reply in place; nothing is saved, so the reply is gone when the view closes.
 * The first use asks for confirmation; an "i" popover repeats the warning.
 */
export function ExplainFailures({
  skill,
  groups,
}: {
  skill: Pick<SkillRow, "path" | "name">;
  /** Null while the groups load; an empty list disables the button. */
  groups: FailureGroup[] | null;
}) {
  const s = useSettingsText();
  const [stats, setStats] = useState<{ recording: boolean; redact: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [explanation, setExplanation] = useState<FailureExplanation | null>(null);

  // The recording and redaction flags come from the stats route (design §12).
  useEffect(() => {
    let live = true;
    void skillsApi.stats().then((reply) => {
      if (live && reply.ok) {
        setStats({ recording: reply.data.recording, redact: reply.data.redact });
      }
    });
    return () => {
      live = false;
    };
  }, []);

  async function run() {
    setBusy(true);
    setError("");
    setNotConfigured(false);
    const reply = await skillsApi.explainFailures(skill.path, skill.name);
    setBusy(false);
    if (!reply.ok) {
      if (reply.code === "not-configured") setNotConfigured(true);
      else setError(reply.error);
      return;
    }
    setExplanation(reply.data.explanation);
  }

  const noGroups = groups !== null && groups.length === 0;
  const recordingOff = stats !== null && !stats.recording;
  // Until the flags arrive the page cannot tell whether redaction is on, so it
  // does not offer the button; the confirmation then never shows the weaker text by mistake.
  const disabled = busy || stats === null || recordingOff || noGroups;

  function click() {
    if (disabled) return;
    if (confirmedBefore()) {
      void run();
      return;
    }
    setConfirming(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={disabled} onClick={click}>
          <Sparkles aria-hidden="true" />
          {s("Explain failures")}
        </Button>
        {busy ? (
          <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {s("Explaining… This can take a few minutes.")}
          </span>
        ) : recordingOff ? (
          <span className="text-sm text-muted-foreground">
            {s("Skill learning must be on to explain failures.")}
          </span>
        ) : noGroups ? (
          <span className="text-sm text-muted-foreground">
            {s("No failure groups to explain.")}
          </span>
        ) : null}
        <InfoPopover label={s("About Explain failures")}>
          <div className="space-y-1.5">{warningParagraphs(s, stats?.redact ?? true)}</div>
        </InfoPopover>
      </div>

      {notConfigured ? (
        <Callout tone="info">
          <p>{s("Explaining needs the external API. Set it up first.")}</p>
          <a
            className="underline"
            href={`${ROUTES.settings}#settings-section-external-api`}
            onClick={(event) => {
              event.preventDefault();
              navigate(`${ROUTES.settings}#settings-section-external-api`);
            }}
          >
            {s("External API")}
          </a>
        </Callout>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : null}

      {explanation ? (
        <div className="space-y-3">
          <p className="break-words text-sm" dir="auto">
            {explanation.summary}
          </p>
          <ul className="space-y-2">
            {explanation.causes.map((cause, index) => (
              <CauseCard key={index} cause={cause} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {s(
              "The labels and suggestions are leads from the error text only; the model cannot see the host's code."
            )}
          </p>
        </div>
      ) : null}

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s("Send failures to the external API?")}</DialogTitle>
            <DialogDescription>
              {s("Nothing is sent until you confirm. Nothing is saved.")}
            </DialogDescription>
          </DialogHeader>
          <Callout tone={stats?.redact === false ? "danger" : "warning"}>
            <div className="space-y-1.5">{warningParagraphs(s, stats?.redact ?? true)}</div>
          </Callout>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              {s("Cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                rememberConfirmation();
                setConfirming(false);
                void run();
              }}
            >
              {s("Explain failures")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
