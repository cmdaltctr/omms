import { HOST_ICONS } from "$lib/host-icons";
import type { HostLook } from "$lib/host-looks";
import type { WebHost } from "$lib/host-label";
import { keywordHue } from "../explorer/KeywordBadge";
import { Layers } from "lucide-react";
import { cn } from "$lib/utils";

const MONOGRAM: Record<WebHost, string> = { pi: "Pi", opencode: "OC", "claude-code": "CC" };

/**
 * A host's avatar. Every avatar is the same square, whatever the source image:
 * an uploaded image fills it from its centre. The name beside it is the label,
 * so the avatar itself is decorative.
 */
export function HostAvatar({
  host,
  look,
  className,
}: {
  host: WebHost;
  look: HostLook;
  className?: string;
}) {
  const frame = cn(
    "grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] border",
    className
  );
  if (look.kind === "image") {
    return (
      <span className={cn(frame, "border-border bg-muted")} aria-hidden="true">
        <img src={look.image} alt="" className="size-full object-cover" />
      </span>
    );
  }
  const Icon = look.kind === "icon" ? HOST_ICONS[look.icon] : undefined;
  const hue = keywordHue(host);
  return (
    <span
      className={cn(
        frame,
        "text-ui font-semibold [color:oklch(0.42_0.13_var(--host-hue))] dark:[color:oklch(0.8_0.13_var(--host-hue))]"
      )}
      style={{
        backgroundColor: `oklch(0.72 0.14 ${hue} / 0.18)`,
        borderColor: `oklch(0.72 0.14 ${hue} / 0.45)`,
        ["--host-hue" as string]: String(hue),
      }}
      aria-hidden="true"
    >
      {Icon ? <Icon className="size-5" /> : MONOGRAM[host]}
    </span>
  );
}

/** The Shared view's mark, drawn like a host avatar so the four cards and sidebar entries match. */
export function SharedMark({
  className,
  iconClassName = "size-5",
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-border bg-muted text-muted-foreground",
        className
      )}
    >
      <Layers className={iconClassName} />
    </span>
  );
}
