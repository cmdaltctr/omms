import { TriangleAlert } from "lucide-react";
import { Badge } from "$lib/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { ScrollArea } from "$lib/components/ui/scroll-area";
import { useI18n } from "$lib/i18n";
import { formatDate } from "$lib/format";
import { ROUTES } from "$lib/routes";
import type { ChatSource } from "$lib/chat-api";
import { SkillSourceBody } from "./SkillSourceBody";

type BodyProps = { source: ChatSource; deleted: boolean };

const SECTION_KEY = {
  preferences: "profile-preferences",
  patterns: "profile-patterns",
  workflows: "profile-workflows",
} as const;

/** The saved source: memory text with project, date and tags, or a profile item with evidence. */
export function SourceBody({ source, deleted }: BodyProps) {
  const { t, language } = useI18n();
  const isMemory = source.kind === "memory";
  if (source.kind === "skill") {
    return (
      <div className="grid min-w-0 gap-3">
        {deleted ? (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t("chat-skill-missing")}
          </p>
        ) : null}
        {source.skill ? <SkillSourceBody skill={source.skill} /> : null}
        <p className="text-xs text-muted-foreground">{t("chat-source-note")}</p>
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-3">
      {deleted ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t("chat-source-deleted")}
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {isMemory && source.projectName ? (
          <>
            <dt>{t("chat-source-project")}</dt>
            <dd className="min-w-0 break-words text-foreground">{source.projectName}</dd>
          </>
        ) : null}
        {isMemory && source.createdAt ? (
          <>
            <dt>{t("chat-source-date")}</dt>
            <dd className="text-foreground">
              {formatDate(new Date(source.createdAt).toISOString())}
            </dd>
          </>
        ) : null}
        {!isMemory && source.section ? (
          <>
            <dt>{t("chat-source-profile")}</dt>
            <dd className="text-foreground">
              {t(SECTION_KEY[source.section])}
              {source.category ? ` · ${source.category}` : ""}
            </dd>
          </>
        ) : null}
      </dl>
      {source.tags?.length ? (
        <div className="flex flex-wrap gap-1" aria-label={t("chat-source-tags")}>
          {source.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
      <ScrollArea
        dir={language === "ar" ? "rtl" : "ltr"}
        className="max-h-[45vh] rounded-lg border"
      >
        <p dir="auto" className="whitespace-pre-wrap break-words p-3 text-sm leading-6">
          {source.text}
        </p>
      </ScrollArea>
      {!isMemory && source.evidence?.length ? (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("chat-source-evidence")}
          </span>
          <ul className="grid gap-1 text-xs">
            {source.evidence.map((line, i) => (
              <li key={i} dir="auto" className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("chat-source-note")}</p>
      {isMemory ? (
        <a
          href={ROUTES.project}
          className="text-xs text-primary-label underline-offset-4 hover:underline"
        >
          {t("chat-source-open-project")}
        </a>
      ) : null}
    </div>
  );
}

type Props = {
  source: ChatSource | null;
  deleted: boolean;
  onClose: () => void;
};

export function SourceDialog({ source, deleted, onClose }: Props) {
  const { t } = useI18n();
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {source
              ? `${source.label} · ${source.kind === "memory" ? t("chat-source-memory") : source.kind === "skill" ? `${t("chat-source-skill")} ${source.id}` : t("chat-source-profile")}`
              : ""}
          </DialogTitle>
          <DialogDescription className="sr-only">{source?.text.slice(0, 120)}</DialogDescription>
        </DialogHeader>
        {source ? <SourceBody source={source} deleted={deleted} /> : null}
      </DialogContent>
    </Dialog>
  );
}
