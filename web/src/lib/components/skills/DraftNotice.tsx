import { useState } from "react";
import { useSettingsText } from "$lib/i18n/settings";
import { navigate, ROUTES } from "$lib/router";
import type { SkillsReply } from "$lib/skills-api";
import { Callout } from "./Callout";

export type Notice =
  { kind: "none" } | { kind: "not-configured" } | { kind: "error"; text: string };

/** What a draft call left to say: nothing, no change, a missing external API, or an error. */
export function useDraftNotice() {
  const [value, setValue] = useState<Notice | { kind: "no-change" }>({ kind: "none" });
  return {
    value,
    clear: () => setValue({ kind: "none" }),
    show: (reply: SkillsReply<unknown>) => {
      if (!reply.ok) {
        setValue(
          reply.code === "not-configured"
            ? { kind: "not-configured" }
            : { kind: "error", text: reply.error }
        );
      } else setValue(reply.code === "no-change" ? { kind: "no-change" } : { kind: "none" });
    },
  };
}

export function DraftNotice({ notice }: { notice: ReturnType<typeof useDraftNotice>["value"] }) {
  const s = useSettingsText();
  if (notice.kind === "none") return null;
  if (notice.kind === "no-change")
    return (
      <p role="status" className="text-sm">
        {s("No change proposed")}
      </p>
    );
  if (notice.kind === "error") {
    return (
      <p role="alert" className="text-sm text-destructive-label">
        {notice.text}
      </p>
    );
  }
  const target = `${ROUTES.settings}#settings-section-external-api`;
  return (
    <Callout tone="info">
      <p>{s("Drafting needs the external API. Set it up first.")}</p>
      <a
        className="underline"
        href={target}
        onClick={(event) => {
          event.preventDefault();
          navigate(target);
        }}
      >
        {s("External API")}
      </a>
    </Callout>
  );
}
