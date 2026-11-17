import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { keywordHue } from "$lib/components/explorer/KeywordBadge";
import { useI18n } from "$lib/i18n";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import { navigate } from "$lib/router";
import { revealPageAnchor } from "$lib/settings-navigation";
import {
  PAGE_LABELS,
  SETTINGS_CATALOGUE,
  settingTarget,
  type CatalogueEntry,
} from "$lib/settings-catalogue";
import { searchSettings } from "$lib/settings-search";

/** A small page name with its own colour, so the reader sees where a result lives. */
function pagePill(label: string) {
  const hue = keywordHue(label);
  return (
    <span
      className="inline-flex min-h-5 items-center rounded-[7px] border px-2 text-xs [color:oklch(0.42_0.13_var(--keyword-hue))] dark:[color:oklch(0.8_0.13_var(--keyword-hue))]"
      style={{
        backgroundColor: `oklch(0.72 0.14 ${hue} / 0.18)`,
        borderColor: `oklch(0.72 0.14 ${hue} / 0.45)`,
        ["--keyword-hue" as string]: String(hue),
      }}
    >
      {label}
    </span>
  );
}

/**
 * The search box above the Settings cards. It lists every setting the web UI can change whose
 * plain name, description or config key matches, on any page. A result opens that page at its
 * card. When nothing matches, it says that some settings live only in the config file.
 */
export function SettingsSearch({
  entries = SETTINGS_CATALOGUE,
  onChoose,
}: {
  entries?: readonly CatalogueEntry[];
  /** Runs after a result opens its page. */
  onChoose?: (entry: CatalogueEntry) => void;
}) {
  const t = useCatalogueText();
  const { language } = useI18n();
  const [query, setQuery] = useState("");
  const results = searchSettings(query, entries, language);

  function open(entry: CatalogueEntry) {
    const { path, hash } = settingTarget(entry);
    navigate(`${path}${hash}`);
    // Navigation scrolls to the card; this also moves focus there from the search box.
    revealPageAnchor(hash, { focus: true });
    onChoose?.(entry);
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          className="ps-8"
          aria-label={t("Search settings")}
          placeholder={t("Search settings, for example reranker")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {results.length > 0 ? (
        <ul aria-label={t("Matching settings")} className="space-y-1.5">
          {results.map((entry) => (
            <li key={entry.key} className="min-w-0">
              <Button
                type="button"
                variant="outline"
                data-result={entry.key}
                className="h-auto w-full min-w-0 flex-col items-start gap-1 whitespace-normal px-3 py-2 text-start"
                onClick={() => open(entry)}
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">{t(entry.name)}</span>
                  {pagePill(t(PAGE_LABELS[entry.page]))}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t(entry.description)}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t(
            "No setting matches. Some settings live only in the config file. See the Configuration guide, docs/configuration.md."
          )}
        </p>
      ) : null}
    </div>
  );
}
