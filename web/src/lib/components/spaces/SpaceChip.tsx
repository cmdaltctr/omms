import type { AvatarLook } from "$lib/avatar-look";
import { HOST_ICONS } from "$lib/host-icons";
import { spaceChipHue, spaceInitials } from "$lib/space-chip";
import { cn } from "$lib/utils";

/**
 * A rounded chip for a space, in the design of a host avatar. The default look shows the two
 * letters of the name, coloured from the name. A chosen icon sits in the same chip, and an
 * uploaded image fills it from its centre. A name that is not in the icon list shows the letters.
 * The card uses the default 40px size. The sidebar tree passes a smaller `className` and
 * `iconClassName`.
 */
export function SpaceChip({
  name,
  look = { kind: "default" },
  className,
  iconClassName = "size-5",
}: {
  name: string;
  look?: AvatarLook;
  className?: string;
  iconClassName?: string;
}) {
  const frame = cn(
    "grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] border text-ui font-semibold",
    className
  );
  if (look.kind === "image") {
    return (
      <span aria-hidden="true" className={cn(frame, "border-border bg-muted")}>
        <img src={look.image} alt="" className="size-full object-cover" />
      </span>
    );
  }
  const Icon = look.kind === "icon" ? HOST_ICONS[look.icon] : undefined;
  const hue = spaceChipHue(name);
  return (
    <span
      aria-hidden="true"
      className={cn(
        frame,
        "[color:oklch(0.42_0.13_var(--host-hue))] dark:[color:oklch(0.8_0.13_var(--host-hue))]"
      )}
      style={{
        backgroundColor: `oklch(0.72 0.14 ${hue} / 0.18)`,
        borderColor: `oklch(0.72 0.14 ${hue} / 0.45)`,
        ["--host-hue" as string]: String(hue),
      }}
    >
      {Icon ? <Icon className={iconClassName} /> : <bdi>{spaceInitials(name)}</bdi>}
    </span>
  );
}
