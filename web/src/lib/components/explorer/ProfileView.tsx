import { useMemo, useState } from "react";
import {
  Activity,
  Heart,
  RotateCcwClock,
  Info,
  Pencil,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  UserX,
  Workflow,
} from "lucide-react";
import { ChangelogDialog } from "./ChangelogDialog";
import { keywordHue } from "./KeywordBadge";
import { ProfileItemDialog } from "./ProfileItemDialog";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { formatDate } from "$lib/format";
import { useI18n } from "$lib/i18n";
import { cn } from "$lib/utils";
import { CONFIDENCE_CLASSES, confidenceLevel, parseProfileField } from "$lib/profile-utils";
import type { ProfileItem, UserProfile } from "$lib/types";

type ProfileField = "preferences" | "patterns" | "workflows";

type Props = {
  profile: UserProfile | null;
  loading?: boolean;
  onRefresh?: () => void;
  onCleanup?: () => void;
};

const PAGE_SIZE = 20;

function pageSlice<T>(items: T[], page: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  return {
    items: items.slice(start, start + PAGE_SIZE),
    total,
    totalPages,
    page: safePage,
    start,
  };
}

function confidencePct(item: ProfileItem) {
  return Math.round((item.confidence || 0) * 100);
}

function evidenceTitle(item: ProfileItem) {
  if (!item.evidence) return "";
  return Array.isArray(item.evidence) ? item.evidence.join("\n") : item.evidence;
}

function evidenceCount(item: ProfileItem) {
  if (!item.evidence) return 0;
  return Array.isArray(item.evidence) ? item.evidence.length : 1;
}

export function ProfileView({ profile, loading = false, onRefresh, onCleanup }: Props) {
  const { t } = useI18n();
  const [profilePages, setProfilePages] = useState({ pref: 1, pat: 1, wf: 1 });
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemType, setItemType] = useState<ProfileField | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  const [itemAction, setItemAction] = useState<"edit" | "delete">("edit");
  const [itemData, setItemData] = useState<ProfileItem | null>(null);

  const profileData = useMemo(() => {
    if (!profile?.exists || !profile.profileData) return null;
    let data = profile.profileData;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }
    return data as NonNullable<UserProfile["profileData"]>;
  }, [profile]);

  const preferences = useMemo(() => parseProfileField(profileData?.preferences), [profileData]);
  const patterns = useMemo(() => parseProfileField(profileData?.patterns), [profileData]);
  const workflowsRaw = useMemo(() => parseProfileField(profileData?.workflows), [profileData]);
  const workflows = useMemo(
    () =>
      workflowsRaw
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (b.item.frequency || 0) - (a.item.frequency || 0)),
    [workflowsRaw]
  );

  const prefPage = pageSlice(preferences, profilePages.pref);
  const patPage = pageSlice(patterns, profilePages.pat);
  const wfPage = pageSlice(workflows, profilePages.wf);
  const workflowsCount = workflowsRaw.length;

  function openItem(type: ProfileField, index: number, action: "edit" | "delete") {
    const list =
      type === "preferences" ? preferences : type === "patterns" ? patterns : workflowsRaw;
    const current = list[index];
    if (!current) return;
    setItemType(type);
    setItemIndex(index);
    setItemAction(action);
    setItemData(current);
    setItemDialogOpen(true);
  }

  function indexOfItem(list: ProfileItem[], item: ProfileItem) {
    return list.indexOf(item);
  }

  function Pager({
    page,
    pageKey,
  }: {
    page: { total: number; totalPages: number; page: number; start: number };
    pageKey: "pref" | "pat" | "wf";
  }) {
    if (page.total <= PAGE_SIZE) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-2">
        <span className="text-xs text-muted-foreground me-2">
          {page.start + 1}-{Math.min(page.start + PAGE_SIZE, page.total)} / {page.total}
        </span>
        {Array.from({ length: page.totalPages }, (_, i) => i + 1).map((p) => (
          <Button
            key={p}
            size="xs"
            variant={p === page.page ? "default" : "outline"}
            onClick={() => setProfilePages((prev) => ({ ...prev, [pageKey]: p }))}
          >
            {p}
          </Button>
        ))}
      </div>
    );
  }

  function ItemCard({
    item,
    type,
    fullList,
  }: {
    item: ProfileItem;
    type: ProfileField;
    fullList: ProfileItem[];
  }) {
    const idx = indexOfItem(fullList, item);
    const pct = confidencePct(item);
    return (
      <div className="min-w-0 rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          {type !== "workflows" || item.category ? (
            <Badge
              variant="outline"
              className="bg-transparent border-current [color:oklch(0.42_0.13_var(--category-hue))] dark:[color:oklch(0.8_0.13_var(--category-hue))]"
              style={{
                ["--category-hue" as string]: String(keywordHue(item.category || "General")),
              }}
            >
              {item.category || "General"}
            </Badge>
          ) : null}
          <div className="flex items-center gap-0.5 ms-auto">
            <Button
              variant="ghost"
              size="icon-xs"
              title={t("btn-edit") || "Edit"}
              onClick={() => openItem(type, idx, "edit")}
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title={t("btn-delete") || "Delete"}
              onClick={() => openItem(type, idx, "delete")}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
          <div
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums",
              CONFIDENCE_CLASSES[confidenceLevel(pct)]
            )}
            title={`${t("label-confidence")}: ${pct}%`}
          >
            {pct}%
          </div>
        </div>
        <p className="text-sm break-words">{item.description || ""}</p>
        {item.steps?.length ? (
          <ol className="flex flex-col items-start gap-1.5">
            {item.steps.map((step, i) => (
              <li
                key={i}
                className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-blue-600/40 bg-blue-500/15 py-0.5 ps-0.5 pe-2.5 text-xs text-blue-700 dark:text-blue-400"
              >
                <span className="flex size-5 shrink-0 items-center justify-center self-start rounded-full bg-blue-500/30 text-[11px] font-medium tabular-nums dark:bg-blue-400/30">
                  {i + 1}
                </span>
                <span className="min-w-0 break-words">{step}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {item.evidence || item.frequency ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="inline-flex items-center gap-1"
              title={t("label-evidence-tooltip", { count: item.frequency || 1 })}
            >
              <Target className="size-3" />
              {item.frequency || 1}
            </span>
            {evidenceCount(item) > 0 ? (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1" title={evidenceTitle(item)}>
                  <Info className="size-3" />
                  {evidenceCount(item)} evidence
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (loading && !profile) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">{t("loading-profile")}</div>
    );
  }

  if (!profile?.exists) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
        <UserX className="size-8" />
        <p className="text-sm">{profile?.message || t("empty-preferences")}</p>
      </div>
    );
  }

  if (!profileData) return null;

  return (
    <>
      <div className="space-y-8">
        <div className="space-y-3">
          <h2 dir="auto" className="text-section-title font-semibold break-words">
            {profile.displayName || profile.userId}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">{t("profile-version")}</span>
              <span className="ms-1 font-mono">{profile.version}</span>
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">{t("profile-prompts")}</span>
              <span className="ms-1 font-mono">{profile.totalPromptsAnalyzed}</span>
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">{t("profile-updated")}</span>
              <span className="ms-1">
                {profile.lastAnalyzedAt ? formatDate(profile.lastAnalyzedAt) : "—"}
              </span>
            </span>
            <div className="ms-auto flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => onCleanup?.()}>
                <Sparkles className="size-3.5" />
                {t("btn-ai-cleanup")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onRefresh?.()}>
                <RefreshCw className="size-3.5" />
                {t("btn-refresh")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setChangelogOpen(true)}>
                <RotateCcwClock className="size-3.5" />
                History
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-8">
          <section id="profile-preferences" className="scroll-mt-4 space-y-3">
            <h2 className="flex flex-wrap items-center gap-2 text-section-title font-semibold">
              <Heart className="size-4" />
              {t("profile-preferences")}
              <span className="text-xs font-normal text-muted-foreground">
                {preferences.length}
              </span>
            </h2>
            {preferences.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty-preferences")}</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {prefPage.items.map((item) => (
                    <ItemCard
                      key={indexOfItem(preferences, item)}
                      item={item}
                      type="preferences"
                      fullList={preferences}
                    />
                  ))}
                </div>
                <Pager page={prefPage} pageKey="pref" />
              </>
            )}
          </section>

          <section id="profile-patterns" className="scroll-mt-4 space-y-3">
            <h2 className="flex flex-wrap items-center gap-2 text-section-title font-semibold">
              <Activity className="size-4" />
              {t("profile-patterns")}
              <span className="text-xs font-normal text-muted-foreground">{patterns.length}</span>
            </h2>
            {patterns.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty-patterns")}</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {patPage.items.map((item) => (
                    <ItemCard
                      key={indexOfItem(patterns, item)}
                      item={item}
                      type="patterns"
                      fullList={patterns}
                    />
                  ))}
                </div>
                <Pager page={patPage} pageKey="pat" />
              </>
            )}
          </section>

          <section id="profile-workflows" className="scroll-mt-4 space-y-3">
            <h2 className="flex flex-wrap items-center gap-2 text-section-title font-semibold">
              <Workflow className="size-4" />
              {t("profile-workflows")}
              <span className="text-xs font-normal text-muted-foreground">{workflowsCount}</span>
            </h2>
            {workflowsCount === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty-workflows")}</p>
            ) : (
              <>
                <div className="grid items-start gap-3 lg:grid-cols-2">
                  {wfPage.items.map((entry) => (
                    <ItemCard
                      key={entry.index}
                      item={entry.item}
                      type="workflows"
                      fullList={workflowsRaw}
                    />
                  ))}
                </div>
                <Pager page={wfPage} pageKey="wf" />
              </>
            )}
          </section>
        </div>
      </div>

      <ChangelogDialog
        open={changelogOpen}
        onOpenChange={setChangelogOpen}
        profileId={profile?.id || ""}
      />

      <ProfileItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        type={itemType}
        index={itemIndex}
        action={itemAction}
        item={itemData}
        onSaved={onRefresh}
      />
    </>
  );
}
