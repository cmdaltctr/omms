import { useLayoutEffect, useRef } from "react";
import { Badge } from "$lib/components/ui/badge";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useSettingsText } from "$lib/i18n/settings";
import { isFollowing, shortTime, type LogLevel, type LogRecord } from "$lib/log-records";

const BADGE_VARIANT = { info: "info", warn: "warning", error: "destructive" } as const;

function LevelBadge({ level, guessed }: { level: LogLevel; guessed: boolean }) {
  const s = useSettingsText();
  const badge = (
    <Badge
      variant={BADGE_VARIANT[level]}
      tabIndex={guessed ? 0 : undefined}
      className="w-14 justify-center"
    >
      {s(level)}
      {guessed && <span className="sr-only">, {s("Level guessed from the message")}</span>}
    </Badge>
  );
  return guessed ? <Tooltip content={s("Level guessed from the message")}>{badge}</Tooltip> : badge;
}

/**
 * The record list. It follows the newest record until the reader scrolls up, and
 * follows again once the reader is back at the bottom.
 */
export function LogPanel({
  records,
  emptyText,
  label,
}: {
  records: LogRecord[];
  emptyText: string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const node = box.current;
    if (node && following.current) node.scrollTop = node.scrollHeight;
  }, [records]);
  return (
    <div
      ref={box}
      role="log"
      aria-live="off"
      aria-label={label}
      tabIndex={0}
      onScroll={() => {
        if (box.current) following.current = isFollowing(box.current);
      }}
      className="max-h-80 overflow-auto rounded-lg bg-background p-3 text-xs"
    >
      {records.length === 0 ? (
        <p className="text-muted-foreground">{emptyText}</p>
      ) : (
        <ol dir="ltr" className="space-y-1.5 text-start">
          {records.map((record) => (
            <li key={record.seq} className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <time
                dateTime={record.time}
                title={record.time}
                className="shrink-0 font-mono text-muted-foreground"
              >
                {shortTime(record.time)}
              </time>
              <LevelBadge level={record.level} guessed={record.guessed} />
              <span className="min-w-0 basis-full break-words whitespace-pre-wrap sm:basis-0 sm:flex-1">
                {record.message}
                {record.data && (
                  <span className="font-mono text-muted-foreground"> {record.data}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
