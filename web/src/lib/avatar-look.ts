/** How an avatar looks, as the server reports it for a host and for a space. */
export type AvatarLook =
  { kind: "default" } | { kind: "icon"; icon: string } | { kind: "image"; image: string };

/** What the avatar dialog asks to save: a chosen icon, a cropped PNG, or the default look again. */
export type AvatarChange =
  { kind: "icon"; icon: string } | { kind: "image"; png: string } | { kind: "reset" };
