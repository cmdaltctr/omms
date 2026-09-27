import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Folder, Moon, Sun, User, X } from "lucide-react";
import type { Lang } from "$lib/i18n/translations";
import { GithubIcon } from "$lib/components/icons/GithubIcon";
import { Button } from "$lib/components/ui/button";
import { Separator } from "$lib/components/ui/separator";
import { navigate, ROUTES, type AppView } from "$lib/router";
import { toggleTheme, useTheme } from "$lib/theme";
import { cn } from "$lib/utils";

type Props = {
  open?: boolean;
  currentView: AppView;
  brand: string;
  projectLabel: string;
  profileLabel: string;
  langLabel: string;
  languageLabel: string;
  themeLabel: string;
  closeLabel: string;
  onOpenChange?: (open: boolean) => void;
  onLanguageSelect?: (language: Lang) => void;
};

const LANGUAGE_OPTIONS: { code: Lang; label: string }[] = [
  { code: "en", label: "English (EN)" },
  { code: "zh", label: "中文 (ZH)" },
  { code: "ar", label: "العربية (AR)" },
];

export function AppSidebar({
  open = false,
  currentView,
  brand,
  projectLabel,
  profileLabel,
  langLabel,
  languageLabel,
  themeLabel,
  closeLabel,
  onOpenChange,
  onLanguageSelect,
}: Props) {
  const theme = useTheme();
  const isDark = theme === "dark";
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languageContainer = useRef<HTMLDivElement>(null);
  const languageTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!languageMenuOpen) return;
    languageContainer.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
    function dismiss(event: PointerEvent) {
      if (!languageContainer.current?.contains(event.target as Node)) {
        setLanguageMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [languageMenuOpen]);

  function onLanguageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setLanguageMenuOpen(false);
      languageTrigger.current?.focus();
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = Array.from(
      languageContainer.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? []
    );
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }

  function setOpen(next: boolean) {
    onOpenChange?.(next);
  }

  function onNavClick(event: MouseEvent, to: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
    setOpen(false);
  }

  function navClass(active: boolean) {
    return cn(
      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
    );
  }

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label={closeLabel}
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "inset-y-0 start-0 z-50 flex h-svh w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200",
          "fixed md:sticky md:top-0 md:translate-x-0!",
          open ? "translate-x-0" : "max-md:-translate-x-full max-md:rtl:translate-x-full"
        )}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <a
            href={ROUTES.home}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg transition-colors hover:opacity-90"
            onClick={(e) => onNavClick(e, ROUTES.home)}
          >
            <img
              src="/omms-icon.png"
              alt=""
              width={20}
              height={20}
              className="size-5 shrink-0 rounded-sm"
            />
            <span className="truncate text-sm font-medium tracking-wide text-sidebar-primary">
              {brand}
            </span>
          </a>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden shrink-0"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </Button>
        </div>

        <Separator className="bg-sidebar-border" />

        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
          <a
            href={ROUTES.project}
            className={navClass(currentView === "project")}
            aria-current={currentView === "project" ? "page" : undefined}
            onClick={(e) => onNavClick(e, ROUTES.project)}
          >
            <Folder className="size-4 shrink-0" />
            <span className="truncate text-start">{projectLabel}</span>
          </a>
          <a
            href={ROUTES.profile}
            className={navClass(currentView === "profile")}
            aria-current={currentView === "profile" ? "page" : undefined}
            onClick={(e) => onNavClick(e, ROUTES.profile)}
          >
            <User className="size-4 shrink-0" />
            <span className="truncate text-start">{profileLabel}</span>
          </a>
        </nav>

        <div className="mt-auto p-3">
          <div className="flex w-full items-center rounded-lg border border-sidebar-border/80 bg-card/70">
            <div ref={languageContainer} className="relative flex min-w-0 flex-1">
              <button
                ref={languageTrigger}
                type="button"
                className="flex w-full items-center justify-center rounded-s-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={() => setLanguageMenuOpen((open) => !open)}
                aria-label={`${languageLabel}: ${langLabel}`}
                aria-haspopup="menu"
                aria-expanded={languageMenuOpen}
                aria-controls="sidebar-language-menu"
                title={languageLabel}
              >
                <span className="text-xs tabular-nums">{langLabel}</span>
              </button>
              {languageMenuOpen ? (
                <div
                  id="sidebar-language-menu"
                  role="menu"
                  aria-label={languageLabel}
                  onKeyDown={onLanguageKeyDown}
                  className="absolute bottom-full start-0 z-10 mb-2 w-44 max-h-[60vh] overflow-y-auto rounded-lg border border-sidebar-border bg-card p-1 shadow-lg"
                >
                  {LANGUAGE_OPTIONS.map(({ code, label }) => (
                    <button
                      key={code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={langLabel.toLowerCase() === code}
                      className="flex w-full rounded-md px-2.5 py-2 text-start text-sm text-card-foreground hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
                      onClick={() => {
                        onLanguageSelect?.(code);
                        setLanguageMenuOpen(false);
                        languageTrigger.current?.focus();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="inline-flex items-center self-stretch border-s border-sidebar-border px-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => toggleTheme()}
              aria-label={themeLabel}
              title={themeLabel}
            >
              {isDark ? (
                <Moon className="size-4 rounded-md p-0.5" />
              ) : (
                <Sun className="size-4 rounded-md p-0.5" />
              )}
            </button>
            <a
              href="https://github.com/cmdaltctr/omms"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center self-stretch rounded-e-lg border-s border-sidebar-border px-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              title="GitHub"
              aria-label="GitHub"
            >
              <GithubIcon className="size-4" />
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
