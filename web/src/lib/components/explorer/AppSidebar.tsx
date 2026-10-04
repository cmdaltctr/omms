import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  ChevronRight,
  Folder,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  User,
  X,
} from "lucide-react";
import type { Lang } from "$lib/i18n/translations";
import { GithubIcon } from "$lib/components/icons/GithubIcon";
import { PowerButton } from "$lib/components/explorer/PowerButton";
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
  profileSections: { id: string; label: string }[];
  /** The Settings page cards, shown as a collapsible tree under Settings. */
  settingsSections?: { id: string; label: string }[];
  langLabel: string;
  languageLabel: string;
  themeLabel: string;
  settingsLabel: string;
  closeLabel: string;
  collapseLabel: string;
  expandLabel: string;
  onOpenChange?: (open: boolean) => void;
  onLanguageSelect?: (language: Lang) => void;
};

const LANGUAGE_OPTIONS: { code: Lang; label: string }[] = [
  { code: "en", label: "English (EN)" },
  { code: "zh", label: "中文 (ZH)" },
  { code: "ar", label: "العربية (AR)" },
];

const COLLAPSED_KEY = "omms-sidebar-collapsed";
const SETTINGS_TREE_KEY = "omms-sidebar-settings-open";

/** Shared base for the sidebar footer icon controls; each call site adds its own shape and edges. */
const FOOTER_ICON_BUTTON =
  "inline-flex min-h-11 min-w-11 md:min-h-8 md:min-w-7 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** The saved open state of the Settings tree, or null when none is saved. */
function readSettingsTreeOpen(): boolean | null {
  try {
    const value = localStorage.getItem(SETTINGS_TREE_KEY);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppSidebar({
  open = false,
  currentView,
  brand,
  projectLabel,
  profileLabel,
  profileSections,
  settingsSections = [],
  langLabel,
  languageLabel,
  themeLabel,
  settingsLabel,
  closeLabel,
  collapseLabel,
  expandLabel,
  onOpenChange,
  onLanguageSelect,
}: Props) {
  const theme = useTheme();
  const isDark = theme === "dark";
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languageContainer = useRef<HTMLDivElement>(null);
  const languageTrigger = useRef<HTMLButtonElement>(null);
  // Collapsing only applies on desktop; the mobile drawer always shows the full sidebar.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const onDesktop = (classes: string) => (collapsed ? classes : "");
  // With no saved choice, the tree starts open on the Settings page only.
  const [settingsTreeOpen, setSettingsTreeOpen] = useState(
    () => readSettingsTreeOpen() ?? currentView === "settings"
  );

  function toggleSettingsTree() {
    const next = !settingsTreeOpen;
    setSettingsTreeOpen(next);
    try {
      localStorage.setItem(SETTINGS_TREE_KEY, next ? "1" : "0");
    } catch {
      // Storage can be blocked; the toggle still works for this page view.
    }
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Storage can be blocked; the toggle still works for this page view.
    }
  }

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

  function onSectionClick(event: MouseEvent, id: string, view: "profile" | "settings" = "profile") {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    const scroll = () =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (currentView === view) {
      scroll();
    } else {
      navigate(view === "settings" ? ROUTES.settings : ROUTES.profile);
      // The profile view renders after navigation; wait for its sections to appear.
      let tries = 0;
      const wait = () => {
        if (document.getElementById(id)) scroll();
        else if (tries++ < 50) requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    }
    setOpen(false);
  }

  function navClass(active: boolean) {
    return cn(
      "flex w-full min-w-0 min-h-11 md:min-h-9 items-center gap-2 rounded-[10px] px-3 py-2 text-ui transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
      onDesktop("md:justify-center md:px-0"),
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground hover:bg-interactive-hover active:bg-interactive-active"
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
          "inset-y-0 start-0 z-50 flex h-svh w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[transform,width] duration-200",
          onDesktop("md:w-14"),
          "fixed md:sticky md:top-0 md:translate-x-0!",
          open ? "translate-x-0" : "max-md:-translate-x-full max-md:rtl:translate-x-full"
        )}
      >
        <div className={cn("flex items-center gap-2 px-4 py-4", onDesktop("md:flex-col md:px-2"))}>
          <a
            href={ROUTES.home}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg transition-colors hover:opacity-90"
            onClick={(e) => onNavClick(e, ROUTES.home)}
          >
            <img
              src="/omms-icon.svg"
              alt=""
              width={20}
              height={20}
              className="size-5 shrink-0 rounded-sm"
            />
            <span
              className={cn(
                "truncate text-ui font-medium tracking-wide text-primary-label",
                onDesktop("md:hidden")
              )}
            >
              {brand}
            </span>
          </a>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden shrink-0 text-muted-foreground hover:text-primary md:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? expandLabel : collapseLabel}
            aria-expanded={!collapsed}
            title={collapsed ? expandLabel : collapseLabel}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 rtl:-scale-x-100" />
            ) : (
              <PanelLeftClose className="size-4 rtl:-scale-x-100" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden min-h-11 min-w-11 shrink-0"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </Button>
        </div>

        <Separator className="bg-sidebar-border" />

        <nav
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3",
            onDesktop("md:px-2")
          )}
          aria-label="Main"
        >
          <a
            href={ROUTES.project}
            className={navClass(currentView === "project")}
            aria-current={currentView === "project" ? "page" : undefined}
            title={collapsed ? projectLabel : undefined}
            onClick={(e) => onNavClick(e, ROUTES.project)}
          >
            <Folder className="size-4 shrink-0" />
            <span className={cn("min-w-0 break-words text-start", onDesktop("md:sr-only"))}>
              {projectLabel}
            </span>
          </a>
          <a
            href={ROUTES.profile}
            className={navClass(currentView === "profile")}
            aria-current={currentView === "profile" ? "page" : undefined}
            title={collapsed ? profileLabel : undefined}
            onClick={(e) => onNavClick(e, ROUTES.profile)}
          >
            <User className="size-4 shrink-0" />
            <span className={cn("min-w-0 break-words text-start", onDesktop("md:sr-only"))}>
              {profileLabel}
            </span>
          </a>
          <ul
            className={cn(
              "ms-5 space-y-0.5 border-s border-sidebar-border ps-2",
              onDesktop("md:hidden")
            )}
          >
            {profileSections.map((section) => (
              <li key={section.id}>
                <a
                  href={`${ROUTES.profile}#${section.id}`}
                  className="flex min-h-11 md:min-h-7 items-center break-words rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  onClick={(e) => onSectionClick(e, section.id)}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-0.5">
            <a
              href={ROUTES.settings}
              className={navClass(currentView === "settings")}
              aria-current={currentView === "settings" ? "page" : undefined}
              title={collapsed ? settingsLabel : undefined}
              onClick={(e) => onNavClick(e, ROUTES.settings)}
            >
              <Settings className="size-4 shrink-0" />
              <span
                className={cn("min-w-0 break-words text-start uppercase", onDesktop("md:sr-only"))}
              >
                {settingsLabel}
              </span>
            </a>
            {settingsSections.length > 0 ? (
              <button
                type="button"
                className={cn(
                  "inline-flex min-h-11 min-w-11 md:min-h-7 md:min-w-7 shrink-0 items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  onDesktop("md:hidden")
                )}
                onClick={toggleSettingsTree}
                aria-expanded={settingsTreeOpen}
                aria-controls="sidebar-settings-tree"
                aria-label={settingsLabel}
                title={settingsLabel}
              >
                <ChevronRight
                  className={cn(
                    "size-4 transition-transform rtl:-scale-x-100",
                    settingsTreeOpen && "rotate-90 rtl:rotate-90"
                  )}
                />
              </button>
            ) : null}
          </div>
          {settingsTreeOpen && settingsSections.length > 0 ? (
            <ul
              id="sidebar-settings-tree"
              className={cn(
                "ms-5 space-y-0.5 border-s border-sidebar-border ps-2",
                onDesktop("md:hidden")
              )}
            >
              {settingsSections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`${ROUTES.settings}#${section.id}`}
                    className="flex min-h-11 md:min-h-7 items-center break-words rounded-lg px-2.5 py-1 text-xs uppercase text-muted-foreground transition-colors duration-150 hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                    onClick={(e) => onSectionClick(e, section.id, "settings")}
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </nav>

        <div className={cn("mt-auto p-3", onDesktop("md:px-2"))}>
          <div
            className={cn(
              "flex w-fit items-center rounded-lg border border-sidebar-border/80 bg-card/70",
              onDesktop(
                "md:mx-auto md:flex-col md:[&>*]:justify-center md:[&>*]:py-1.5 md:[&>*+*]:border-s-0 md:[&>*+*]:border-t md:[&>*]:rounded-none"
              )
            )}
          >
            <div
              ref={languageContainer}
              className="relative flex self-stretch"
              onBlur={(event) => {
                // Tabbing out of the menu closes it; moving between the trigger and options does not.
                if (!languageContainer.current?.contains(event.relatedTarget as Node | null)) {
                  setLanguageMenuOpen(false);
                }
              }}
            >
              <button
                ref={languageTrigger}
                type="button"
                className={`${FOOTER_ICON_BUTTON} rounded-s-lg px-1.5 py-1.5 text-ui`}
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
                      className="flex min-h-11 md:min-h-9 w-full items-center rounded-md px-2.5 py-2 text-start text-ui text-card-foreground aria-checked:bg-selection hover:bg-interactive-hover focus-visible:bg-selection focus-visible:outline-2 focus-visible:outline-ring"
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
              className={`${FOOTER_ICON_BUTTON} self-stretch border-s border-sidebar-border px-1.5`}
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
              href={ROUTES.settings}
              className={`${FOOTER_ICON_BUTTON} self-stretch border-s border-sidebar-border px-1.5`}
              onClick={(e) => onNavClick(e, ROUTES.settings)}
              aria-label={settingsLabel}
              title={settingsLabel}
              aria-current={currentView === "settings" ? "page" : undefined}
            >
              <Settings className="size-4" />
            </a>
            <PowerButton />
            <a
              href="https://github.com/cmdaltctr/omms"
              target="_blank"
              rel="noopener noreferrer"
              className={`${FOOTER_ICON_BUTTON} self-stretch rounded-e-lg border-s border-sidebar-border px-1.5`}
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
