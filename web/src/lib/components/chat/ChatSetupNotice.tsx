import { Settings, TriangleAlert } from "lucide-react";
import { useI18n } from "$lib/i18n";
import type { ChatStatus } from "$lib/chat-api";

/** Shown when chat cannot call the memory model: names the missing settings, never their values. */
export function ChatSetupNotice({ status }: { status: ChatStatus }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="grid gap-2 rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        {t("chat-setup-title")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("chat-setup-body", { names: status.missing.join(", ") })}
      </p>
      <a
        href="/settings#settings-section-external-api"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-primary-label underline-offset-4 hover:underline"
      >
        <Settings className="size-3.5" aria-hidden="true" />
        {t("chat-setup-link")}
      </a>
    </div>
  );
}
