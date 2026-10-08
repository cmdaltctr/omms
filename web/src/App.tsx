import { useEffect, useState, type MouseEvent } from "react";
import { Select } from "$lib/components/ui/select";
import { Loader, Menu, Plus, RefreshCw, Search, Trash, TriangleAlert, X } from "lucide-react";
import { useMemoriesExplorer } from "@/hooks/useMemoriesExplorer";
import { useUserProfile } from "@/hooks/useUserProfile";
import { AiCleanupDialog } from "$lib/components/explorer/AiCleanupDialog";
import { AppSidebar } from "$lib/components/explorer/AppSidebar";
import { EditMemoryDialog } from "$lib/components/explorer/EditMemoryDialog";
import { SidebarBrand } from "$lib/components/explorer/SidebarBrand";
import { MemoryList } from "$lib/components/explorer/MemoryList";
import { ProfileView } from "$lib/components/explorer/ProfileView";
import { TagMigrationDialog } from "$lib/components/explorer/TagMigrationDialog";
import { SettingsView } from "$lib/components/settings/SettingsView";
import { MemoryView } from "$lib/components/memory/MemoryView";
import { MEMORY_SECTIONS } from "$lib/memory-sections";
import { Alert, AlertDescription } from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Toaster } from "$lib/components/ui/sonner";
import { Tooltip } from "$lib/components/ui/tooltip";
import { Textarea } from "$lib/components/ui/textarea";
import { setLanguage, useI18n } from "$lib/i18n";
import type { Lang } from "$lib/i18n/translations";
import { getDisplayedMemoryCount } from "$lib/memory-count";
import { translateSettings } from "$lib/i18n/settings";
import { SETTINGS_SECTIONS } from "$lib/settings-sections";
import { clearTagMigrationClose, rememberTagMigrationClose } from "$lib/tag-migration-prompt";
import { initRouter, navigate, ROUTES, useAppView } from "$lib/router";

const MEMORY_TYPES = [
  "",
  "feature",
  "bug-fix",
  "refactor",
  "architecture",
  "rule",
  "documentation",
  "discussion",
  "analysis",
  "configuration",
] as const;

export default function App() {
  const { t, language } = useI18n();
  const currentView = useAppView();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const explorer = useMemoriesExplorer();
  const profile = useUserProfile();

  useEffect(() => {
    const stopRouter = initRouter();
    void (async () => {
      await explorer.loadTags();
      await explorer.loadMemories();
      await explorer.loadStats();
      await explorer.checkMigrationStatus();
      await explorer.checkAuthWarning();
    })();
    const refreshTimer = setInterval(() => {
      void explorer.loadStats();
      if (!explorer.isSearching && currentView === "project") {
        void explorer.loadMemories();
      }
    }, 30000);
    return () => {
      stopRouter();
      clearInterval(refreshTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only init
  }, []);

  const loadUserProfile = profile.loadUserProfile;
  useEffect(() => {
    if (currentView === "profile") {
      void loadUserProfile();
    }
  }, [currentView, loadUserProfile]);

  function onLanguageSelect(next: Lang) {
    if (next === language) return;
    setLanguage(next);
    void explorer.loadMemories();
    void explorer.loadStats();
    if (currentView === "profile") void profile.loadUserProfile();
  }

  function onHomeClick(event: MouseEvent) {
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
    navigate(ROUTES.home);
  }

  return (
    <>
      <Toaster richColors position="bottom-right" />

      <div className="flex min-h-svh bg-background text-foreground overflow-x-clip">
        <AppSidebar
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          currentView={currentView}
          brand={t("brand")}
          projectLabel={t("tab-project")}
          profileLabel={t("tab-profile")}
          profileSections={[
            { id: "profile-preferences", label: t("profile-preferences") },
            { id: "profile-patterns", label: t("profile-patterns") },
            { id: "profile-workflows", label: t("profile-workflows") },
          ]}
          memoryLabel={translateSettings("Memory", language)}
          memorySections={MEMORY_SECTIONS.map((section) => ({
            id: section.id,
            label: translateSettings(section.title, language),
          }))}
          settingsSections={SETTINGS_SECTIONS.map((section) => ({
            id: section.id,
            label: translateSettings(section.title, language),
          }))}
          langLabel={language.toUpperCase()}
          languageLabel={t("nav-language")}
          themeLabel={t("nav-theme")}
          settingsLabel={t("nav-settings")}
          closeLabel={t("nav-close")}
          collapseLabel={t("nav-collapse")}
          expandLabel={t("nav-expand")}
          onLanguageSelect={onLanguageSelect}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              className="min-h-11 min-w-11"
              onClick={() => setSidebarOpen(true)}
              aria-label={t("nav-menu")}
            >
              <Menu className="size-4" />
            </Button>
            <a href={ROUTES.home} className="min-w-0" onClick={onHomeClick}>
              <SidebarBrand brand={t("brand")} />
            </a>
          </div>

          <div className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-4 md:p-6">
            {explorer.showAuthWarning ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription>{t("auth-warning-text")}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1
                className={`text-page-title font-semibold text-foreground${
                  language === "en" && (currentView === "memory" || currentView === "settings")
                    ? " uppercase"
                    : ""
                }`}
              >
                {currentView === "project"
                  ? t("tab-project")
                  : currentView === "profile"
                    ? t("tab-profile")
                    : currentView === "memory"
                      ? translateSettings("Memory", language)
                      : t("nav-settings")}
              </h1>
              {currentView === "project" ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {t("text-total", {
                      count: getDisplayedMemoryCount(
                        explorer.isSearching,
                        explorer.totalItems,
                        explorer.statsTotal
                      ),
                    })}
                  </span>
                  {explorer.refreshing ? <Loader className="size-3.5 animate-spin" /> : null}
                </div>
              ) : null}
            </div>

            {currentView === "project" ? (
              <>
                <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0 max-w-full space-y-1">
                    <Label htmlFor="tag-filter">{t("label-tag")}</Label>
                    <Select
                      id="tag-filter"
                      className="w-64 max-w-full"
                      value={explorer.selectedTag}
                      onChange={(e) => explorer.onTagFilterChange(e.currentTarget.value)}
                    >
                      <option value="">{t("opt-all-tags")}</option>
                      {explorer.tags.map((tag) => (
                        <option key={tag.tag} value={tag.tag}>
                          {tag.displayName || tag.tag}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="min-w-0 max-w-full space-y-1">
                    <Label htmlFor="keyword-filter">{t("label-label-filter")}</Label>
                    <Select
                      id="keyword-filter"
                      className="w-56 max-w-full"
                      value={explorer.selectedKeyword.toLowerCase()}
                      onChange={(e) => explorer.onKeywordFilterChange(e.currentTarget.value)}
                    >
                      <option value="">{t("opt-all-labels")}</option>
                      {/* Keep a label picked from a card selectable even when this project has none. */}
                      {explorer.selectedKeyword &&
                      !explorer.keywords.some(
                        (k) => k.keyword === explorer.selectedKeyword.toLowerCase()
                      ) ? (
                        <option value={explorer.selectedKeyword.toLowerCase()}>
                          {explorer.selectedKeyword} (0)
                        </option>
                      ) : null}
                      {explorer.keywords.map((k) => (
                        <option key={k.keyword} value={k.keyword}>
                          {k.keyword} ({k.count})
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-1 items-end gap-1.5 min-w-0 basis-56">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label htmlFor="search-input" className="sr-only">
                        {t("placeholder-search")}
                      </Label>
                      <Input
                        id="search-input"
                        placeholder={t("placeholder-search")}
                        value={explorer.searchInput}
                        onChange={(e) => explorer.setSearchInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && explorer.performSearch()}
                      />
                    </div>
                    <Button variant="outline" size="icon" onClick={explorer.performSearch}>
                      <Search className="size-4" />
                    </Button>
                    {explorer.isSearching ? (
                      <Button variant="outline" size="icon" onClick={explorer.clearSearch}>
                        <X className="size-4" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Tooltip content={t("tooltip-cleanup")}>
                      <Button variant="outline" size="sm" onClick={explorer.runCleanup}>
                        <Trash className="size-3.5" />
                        {t("btn-cleanup")}
                      </Button>
                    </Tooltip>
                    <Tooltip content={t("tooltip-deduplicate")}>
                      <Button variant="outline" size="sm" onClick={explorer.runDeduplication}>
                        <RefreshCw className="size-3.5" />
                        {t("btn-deduplicate")}
                      </Button>
                    </Tooltip>
                  </div>

                  {explorer.selectedIds.size > 0 ? (
                    <div className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-3">
                      <span className="text-xs text-muted-foreground">
                        {t("text-selected", { count: explorer.selectedIds.size })}
                      </span>
                      <Button variant="secondary" size="xs" onClick={explorer.selectAllCurrentPage}>
                        {t("btn-select-all")}
                      </Button>
                      <Button variant="destructive" size="xs" onClick={explorer.bulkDelete}>
                        {t("btn-delete-selected")}
                      </Button>
                      <Button variant="ghost" size="xs" onClick={explorer.deselectAll}>
                        {t("btn-deselect-all")}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {explorer.migrationNeeded ? (
                  <Alert variant="destructive" className="space-y-3">
                    <TriangleAlert />
                    <AlertDescription className="space-y-3">
                      <p>{explorer.migrationMessage || t("migration-mismatch")}</p>
                      <label className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={explorer.migrationConfirmed}
                          onCheckedChange={(v) => explorer.setMigrationConfirmed(v === true)}
                          className="mt-0.5"
                        />
                        <span>{t("migration-understand")}</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={!explorer.migrationConfirmed}
                          onClick={() => explorer.runMigration("fresh-start")}
                        >
                          {t("btn-fresh-start")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!explorer.migrationConfirmed}
                          onClick={() => explorer.runMigration("re-embed")}
                        >
                          {t("btn-reembed")}
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}

                <MemoryList
                  memories={explorer.memories}
                  selectedIds={explorer.selectedIds}
                  currentPage={explorer.currentPage}
                  totalPages={explorer.totalPages}
                  totalItems={explorer.totalItems}
                  isSearching={explorer.isSearching}
                  loading={explorer.loadingMemories}
                  error={explorer.memoriesError}
                  onSelect={explorer.onSelect}
                  onPageChange={(delta) => {
                    const next = explorer.currentPage + delta;
                    explorer.setCurrentPage(next);
                    void explorer.loadMemories({ page: next });
                  }}
                  onPin={explorer.pinMemory}
                  onUnpin={explorer.unpinMemory}
                  onEdit={explorer.openEdit}
                  onDeleteMemory={explorer.deleteMemory}
                  onDeletePrompt={explorer.deletePrompt}
                  activeKeyword={explorer.selectedKeyword}
                  onKeywordClick={(keyword) =>
                    explorer.onKeywordFilterChange(
                      explorer.selectedKeyword.toLowerCase() === keyword.toLowerCase()
                        ? ""
                        : keyword
                    )
                  }
                />

                <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h2 className="text-section-title font-semibold text-muted-foreground">
                    {t("section-add")}
                  </h2>
                  <form className="space-y-3" onSubmit={explorer.addMemory}>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor="add-tag">{t("label-tag")}</Label>
                        <Select
                          id="add-tag"
                          required
                          className="w-full"
                          value={explorer.addTag}
                          onChange={(e) => explorer.setAddTag(e.target.value)}
                        >
                          <option value="">{t("opt-select-tag")}</option>
                          {explorer.tags.map((tag) => (
                            <option key={tag.tag} value={tag.tag}>
                              {tag.displayName || tag.tag}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="add-type">{t("label-type")}</Label>
                        <Select
                          id="add-type"
                          className="w-full"
                          value={explorer.addType}
                          onChange={(e) => explorer.setAddType(e.target.value)}
                        >
                          {MEMORY_TYPES.map((type) => (
                            <option key={type || "other"} value={type}>
                              {t(type ? `opt-${type}` : "opt-other")}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="add-tags">{t("label-tags")}</Label>
                        <Input
                          id="add-tags"
                          placeholder={t("placeholder-tags")}
                          value={explorer.addTags}
                          onChange={(e) => explorer.setAddTags(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="add-content">{t("label-content")}</Label>
                      <Textarea
                        id="add-content"
                        rows={4}
                        required
                        placeholder={t("placeholder-content")}
                        value={explorer.addContent}
                        onChange={(e) => explorer.setAddContent(e.target.value)}
                      />
                    </div>
                    <Button type="submit">
                      <Plus className="size-3.5" />
                      {t("btn-add-memory")}
                    </Button>
                  </form>
                </section>
              </>
            ) : currentView === "memory" ? (
              <MemoryView />
            ) : currentView === "settings" ? (
              <SettingsView />
            ) : (
              <ProfileView
                profile={profile.userProfile}
                loading={profile.loadingProfile}
                onRefresh={profile.refreshProfile}
                onCleanup={() => profile.setAiCleanupOpen(true)}
              />
            )}
          </div>
        </div>
      </div>

      <EditMemoryDialog
        open={explorer.editOpen}
        onOpenChange={explorer.setEditOpen}
        content={explorer.editContent}
        onSave={explorer.saveEdit}
      />
      <TagMigrationDialog
        open={explorer.tagMigrationOpen}
        onOpenChange={(open) => {
          // A Close is remembered, so the dialog does not return on every page load.
          if (!open) rememberTagMigrationClose(explorer.tagMigrationCount);
          explorer.setTagMigrationOpen(open);
        }}
        count={explorer.tagMigrationCount}
        onComplete={() => {
          clearTagMigrationClose();
          void explorer.loadMemories();
          void explorer.loadStats();
        }}
      />
      <AiCleanupDialog
        open={profile.aiCleanupOpen}
        onOpenChange={profile.setAiCleanupOpen}
        profile={profile.userProfile}
        onApplied={profile.loadUserProfile}
      />
    </>
  );
}
