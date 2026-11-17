import { useEffect, useState } from "react";
import { CircleCheck, Settings, TriangleAlert } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Card } from "$lib/components/ui/card";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useI18n } from "$lib/i18n";
import { ROUTES } from "$lib/routes";
import { settingsRequest } from "$lib/settings-api";
import { missingSettingsText } from "$shared/setting-words";

/** The `effective` block of `/api/settings`, as far as the panel reads it. */
type Effective = {
  opencode?: { ready: boolean; issues?: string[] };
  pi?: { kind: string; issues?: string[] };
  "claude-code"?: { ready: boolean; issues?: string[] };
};

export type WelcomeHost = { host: WebHost; ready: boolean; issues: string[] };

const API_LINK = `${ROUTES.settings}#settings-section-external-api`;

/** The panel shows only for an empty space with no search, label or project filter. */
export function showsWelcome(input: {
  totalItems: number;
  isSearching: boolean;
  activeKeyword?: string;
  activeTag?: string;
}): boolean {
  return input.totalItems === 0 && !input.isSearching && !input.activeKeyword && !input.activeTag;
}

/** One row per host, in the order the Settings page lists them. */
export function welcomeHosts(effective: Effective): WelcomeHost[] {
  return [
    {
      host: "opencode",
      ready: effective.opencode?.ready === true,
      issues: effective.opencode?.issues ?? [],
    },
    {
      host: "pi",
      ready: effective.pi?.kind !== "unready",
      issues: effective.pi?.issues ?? [],
    },
    {
      host: "claude-code",
      ready: effective["claude-code"]?.ready === true,
      issues: effective["claude-code"]?.issues ?? [],
    },
  ];
}

/** `undefined` while loading and after a failed request: the panel then has no host list. */
function useWelcomeHosts(): WelcomeHost[] | undefined {
  const [hosts, setHosts] = useState<WelcomeHost[]>();
  useEffect(() => {
    let active = true;
    settingsRequest<{ effective: Effective }>("/api/settings")
      .then((snapshot) => {
        if (active) setHosts(welcomeHosts(snapshot.effective));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return hosts;
}

export function WelcomeView({ hosts }: { hosts?: WelcomeHost[] }) {
  const { t, language } = useI18n();
  const claude = hosts?.find((row) => row.host === "claude-code");
  return (
    <Card className="col-span-full" aria-labelledby="welcome-title">
      <div className="space-y-1">
        <h2 id="welcome-title" className="text-section-title font-semibold">
          {t("welcome-title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("welcome-body")}</p>
      </div>

      {hosts ? (
        <div className="space-y-2">
          <h3 className="text-subsection-title font-semibold">{t("welcome-hosts-title")}</h3>
          <ul className="flex flex-col gap-2">
            {hosts.map((row) => (
              <li key={row.host} className="min-w-0 rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{hostLabel(row.host)}</span>
                  {row.ready ? (
                    <span className="inline-flex items-center gap-1 text-xs text-status-success">
                      <CircleCheck className="size-3.5" aria-hidden="true" />
                      {t("welcome-host-ready")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-status-warning">
                      <TriangleAlert className="size-3.5" aria-hidden="true" />
                      {t("welcome-host-needs-setup")}
                    </span>
                  )}
                </div>
                {!row.ready && row.issues.length > 0 ? (
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {t("welcome-host-missing", {
                      settings: missingSettingsText(row.issues, language),
                    })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {claude?.ready !== true ? (
        <p className="text-sm text-muted-foreground">{t("welcome-claude-note")}</p>
      ) : null}
      <div>
        <Button asChild variant="outline" size="sm">
          <a href={API_LINK}>
            <Settings aria-hidden="true" />
            {t("welcome-api-link")}
          </a>
        </Button>
      </div>
    </Card>
  );
}

export function WelcomePanel() {
  return <WelcomeView hosts={useWelcomeHosts()} />;
}
