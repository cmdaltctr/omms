import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader, X } from "lucide-react";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useSettingsText } from "$lib/i18n/settings";
import {
  hasUnmanagedFields,
  policyLabelKey,
  providerFromRouting,
  routingFromProvider,
  usableTicked,
  type ProviderPolicy,
  type ProviderRow,
  type RoutingState,
} from "$lib/openrouter-routing";
import { createLatestGate, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";

const LIST_PATH = "/api/settings/external-api/openrouter-providers";
const SAVE_PATH = "/api/settings/external-api/openrouter-routing";
// A provider slug (`deepinfra`) or a full endpoint slug with up to two more parts, such as
// `google-vertex/us-east5`. It matches the check on the server.
const SEGMENT = "[a-z0-9][a-z0-9._-]{0,63}";
const SLUG = new RegExp(`^${SEGMENT}(?:/${SEGMENT}){0,2}$`, "i");

type ListReply =
  | { ok: true; providers: ProviderRow[] }
  | { ok: false; reason: "unknown-model" | "timeout" | "unreachable"; error: string };
type ListState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; rows: ProviderRow[] }
  | { kind: "failed"; unknownModel: boolean; reason?: "timeout" | "unreachable"; error: string };
type SaveState = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };
type Shown = { slug: string; name: string; policy?: ProviderPolicy };

const policyVariant = { zdr: "default", safety: "info", unknown: "warning" } as const;

/**
 * A blocked control stays visible. A disabled control gets no hover or focus, so it sits in a
 * focusable span that shows the reason as a tooltip. The caller adds an sr-only line or a
 * visible line with the reason and points the control at it with aria-describedby.
 */
function Blocked({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex">
        {children}
      </span>
    </Tooltip>
  );
}

export function ProviderRows({
  shown,
  ticked,
  zdr,
  onToggle,
  onRemove,
}: {
  shown: Shown[];
  ticked: string[];
  zdr: boolean;
  onToggle: (slug: string, checked: boolean) => void;
  onRemove: (slug: string) => void;
}) {
  const s = useSettingsText();
  return (
    <ul className="space-y-2 sm:w-1/2">
      {shown.map(({ slug, name, policy }) => {
        const id = `openrouter-provider-${slug}`;
        const position = ticked.indexOf(slug) + 1;
        const blocked = zdr && policy === "unknown";
        const reason = s("Not available while Zero data retention only is on.");
        const box = (
          <Checkbox
            id={id}
            checked={position > 0}
            disabled={blocked}
            aria-describedby={blocked ? `${id}-reason` : undefined}
            onCheckedChange={(checked) => onToggle(slug, checked === true)}
          />
        );
        return (
          <li
            key={slug}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2"
          >
            {blocked ? <Blocked reason={reason}>{box}</Blocked> : box}
            <span className="w-6 shrink-0">
              {position > 0 && (
                <Badge variant="outline" data-position={position} data-slug={slug}>
                  <span className="sr-only">{s("Try position")} </span>
                  {position}
                </Badge>
              )}
            </span>
            <Label
              htmlFor={id}
              className="min-w-0 flex-1 basis-[min(100%,12rem)] flex-wrap gap-x-2 gap-y-0 break-words"
            >
              {policy && <bdi className="font-medium">{name}</bdi>}
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                {slug}
              </span>
            </Label>
            {policy && (
              <Badge variant={policyVariant[policy]} className="ms-auto">
                {s(policyLabelKey(policy))}
              </Badge>
            )}
            {blocked && (
              <span id={`${id}-reason`} className="sr-only">
                {reason}
              </span>
            )}
            {!policy && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${s("Remove provider")} ${slug}`}
                onClick={() => onRemove(slug)}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Routing choices for an OpenRouter endpoint. `model` is the model ID typed or saved on the
 * card, `savedModel` the saved one (the providers shown are for `model`, but requests use the
 * saved model), `saved` the saved `provider` object, `savedIsOpenRouter` whether the SAVED API
 * URL is on OpenRouter (the server refuses a routing save until it is), and `debounceMs` the
 * wait after a model edit.
 */
export function OpenRouterRouting({
  model,
  savedModel,
  revision,
  saved,
  savedIsOpenRouter,
  debounceMs = 500,
}: {
  model: string;
  savedModel: string;
  revision: string;
  saved: Record<string, unknown> | null;
  savedIsOpenRouter: boolean;
  debounceMs?: number;
}) {
  const s = useSettingsText();
  const [state, setState] = useState<RoutingState>(() => routingFromProvider(saved));
  const [debounced, setDebounced] = useState(model.trim());
  const [list, setList] = useState<ListState>({ kind: model.trim() ? "loading" : "idle" });
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const gate = useRef(createLatestGate());

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(model.trim()), debounceMs);
    return () => clearTimeout(timer);
  }, [model, debounceMs]);

  useEffect(() => {
    if (!debounced) {
      // Cancel a request still in flight, so its late reply cannot fill the list again.
      gate.current.begin();
      setList({ kind: "idle" });
      return;
    }
    const current = gate.current.begin();
    setList({ kind: "loading" });
    settingsRequest<ListReply>(`${LIST_PATH}?model=${encodeURIComponent(debounced)}`)
      .then((reply) => {
        if (!current()) return;
        setList(
          reply.ok
            ? { kind: "ready", rows: reply.providers }
            : {
                kind: "failed",
                unknownModel: reply.reason === "unknown-model",
                reason: reply.reason === "unknown-model" ? undefined : reply.reason,
                error: reply.error,
              }
        );
      })
      .catch((error: Error) => {
        if (current()) setList({ kind: "failed", unknownModel: false, error: error.message });
      });
  }, [debounced]);

  const loaded = list.kind === "ready" ? list.rows : [];
  const known = new Set(loaded.map((row) => row.slug));
  // Saved or typed slugs that the loaded list does not hold stay visible as manual rows.
  const shown: Shown[] = [
    ...loaded,
    ...state.ticked.filter((slug) => !known.has(slug)).map((slug) => ({ slug, name: slug })),
  ];

  // A routing edit makes "Routing saved." untrue, so it goes with the first change.
  // The count lets a pending save see that the controls changed after it was sent.
  const edits = useRef(0);
  const edit = (change: (previous: RoutingState) => RoutingState) => {
    edits.current += 1;
    setState(change);
    setSave((previous) => (previous.kind === "saved" ? { kind: "idle" } : previous));
  };

  const toggle = (slug: string, checked: boolean) =>
    edit((previous) => ({
      ...previous,
      ticked: checked
        ? [...previous.ticked.filter((item) => item !== slug), slug]
        : previous.ticked.filter((item) => item !== slug),
    }));

  function addManual() {
    const slug = manual.trim();
    const taken = [...state.ticked, ...loaded.map((row) => row.slug)];
    if (!SLUG.test(slug)) return setManualError(s("Not a valid provider slug."));
    if (taken.some((item) => item.toLowerCase() === slug.toLowerCase())) {
      return setManualError(s("That provider is already in the list."));
    }
    setManualError("");
    setManual("");
    toggle(slug, true);
  }

  async function saveRouting() {
    setSave({ kind: "saving" });
    const sent = edits.current;
    try {
      await settingsRequest(SAVE_PATH, {
        method: "POST",
        body: JSON.stringify({ revision, routing: providerFromRouting(state, loaded) }),
      });
      setSave({ kind: edits.current === sent ? "saved" : "idle" });
    } catch (error) {
      setSave({ kind: "error", message: (error as Error).message });
    }
    await reloadSettingsSnapshot();
  }

  const canOnly = usableTicked(state, loaded).length > 0;
  const onlyBox = (
    <Checkbox
      id="openrouter-only"
      checked={state.only && canOnly}
      disabled={!canOnly}
      aria-describedby={canOnly ? undefined : "openrouter-only-reason"}
      onCheckedChange={(checked) => edit((previous) => ({ ...previous, only: checked === true }))}
    />
  );
  // The server refuses a routing save until the OpenRouter URL is saved. The model is checked
  // here: a list or an Only list built for an unsaved model could break the saved model's calls.
  const blockReason = !savedIsOpenRouter
    ? s("Save the endpoint first. Routing applies after the OpenRouter URL is saved.")
    : model.trim() !== savedModel.trim()
      ? s(
          "Save the endpoint first. The providers shown are for the model above, which is not saved yet."
        )
      : undefined;
  const saveButton = (
    <Button
      disabled={save.kind === "saving" || blockReason !== undefined}
      aria-describedby={blockReason === undefined ? undefined : "openrouter-save-reason"}
      onClick={() => void saveRouting()}
    >
      {s("Save routing")}
    </Button>
  );
  const note = (text: string) => <p className="text-xs text-muted-foreground">{text}</p>;
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-3 text-sm"
      aria-label={s("OpenRouter routing")}
    >
      <h3 className="text-subsection-title font-semibold">{s("OpenRouter routing")}</h3>
      {(
        [
          ["data-collection", "dataCollection", "Block providers that may train on or store data"],
          ["zdr", "zdr", "Zero data retention only"],
        ] as const
      ).map(([id, key, label]) => (
        <div key={id} className="flex items-center gap-2">
          <Checkbox
            id={`openrouter-${id}`}
            checked={state[key]}
            onCheckedChange={(checked) =>
              edit((previous) => ({ ...previous, [key]: checked === true }))
            }
          />
          <Label htmlFor={`openrouter-${id}`}>{s(label)}</Label>
        </div>
      ))}

      {note(
        s(
          "OpenRouter can still use providers labelled Abuse checks only. For strict no retention, set ZDR only in your OpenRouter privacy settings."
        )
      )}

      <h4 className="font-medium">{s("Providers for this model")}</h4>
      {note(s("Tick providers in the order OpenRouter should try them."))}
      {list.kind === "idle" && note(s("Enter a model ID to see its providers."))}
      {list.kind === "loading" && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {s("Loading the provider list…")}
        </p>
      )}
      {list.kind === "failed" &&
        list.unknownModel &&
        note(s("OpenRouter has no providers for this model."))}
      {list.kind === "failed" && !list.unknownModel && (
        <>
          <p className="text-sm">
            {s("The provider list is not available.")}
            {list.reason &&
              ` ${
                list.reason === "timeout"
                  ? s("OpenRouter did not answer within 10 seconds.")
                  : s("OpenRouter could not be reached.")
              }`}
          </p>
          {!list.reason && (
            <p className="text-xs text-muted-foreground">
              <bdi>{list.error}</bdi>
            </p>
          )}
        </>
      )}
      <ProviderRows
        shown={shown}
        ticked={usableTicked(state, loaded)}
        zdr={state.zdr}
        onToggle={toggle}
        onRemove={(slug) => toggle(slug, false)}
      />

      <div className="flex gap-2 sm:w-1/2">
        <Input
          dir="ltr"
          className="font-mono"
          aria-label={s("Provider slug")}
          placeholder="deepinfra"
          value={manual}
          aria-invalid={manualError ? true : undefined}
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addManual()}
        />
        <Button variant="outline" onClick={addManual}>
          {s("Add provider")}
        </Button>
      </div>
      {manualError && (
        <p role="alert" className="text-xs text-destructive-label">
          {manualError}
        </p>
      )}

      <div className="flex items-center gap-2">
        {canOnly ? (
          onlyBox
        ) : (
          <Blocked reason={s("Tick at least one provider first.")}>{onlyBox}</Blocked>
        )}
        <Label htmlFor="openrouter-only">{s("Use only these providers")}</Label>
        {!canOnly && (
          <span id="openrouter-only-reason" className="sr-only">
            {s("Tick at least one provider first.")}
          </span>
        )}
      </div>
      {state.only && canOnly && note(s("OpenRouter never falls back to other providers."))}
      {hasUnmanagedFields(saved) &&
        note(s("Other routing fields are set in the config file and are kept."))}

      {blockReason === undefined ? (
        saveButton
      ) : (
        <Blocked reason={blockReason}>{saveButton}</Blocked>
      )}
      {blockReason !== undefined && (
        <p id="openrouter-save-reason" className="text-xs text-muted-foreground">
          {blockReason}
        </p>
      )}
      {save.kind === "saving" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {s("Saving routing…")}
        </p>
      )}
      {save.kind === "saved" && (
        <p role="status" className="text-sm">
          {s("Routing saved.")}
        </p>
      )}
      {save.kind === "error" && (
        <p role="alert" className="text-sm text-destructive-label">
          {save.message}
        </p>
      )}
    </section>
  );
}
