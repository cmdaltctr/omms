import { THEME_DATA } from "./theme-data";
import type { ThemeColours, ThemeDefinition } from "./types";

export type { ThemeDefinition };
export type ThemeVariant = "light" | "dark";

/**
 * The OMMS default pair. Its colours live in `app.css`, so choosing it adds no
 * rule; these copies only draw its swatch.
 */
export const DEFAULT_LIGHT_THEME = "omms-light";
export const DEFAULT_DARK_THEME = "omms-dark";

const OMMS_LIGHT: ThemeColours = {
  canvas: "#fdfcfa",
  elevated: "#f8f7f5",
  muted: "#f7f6f4",
  text: "#393a34",
  textSecondary: "#5c5c54",
  border: "#e5e1de",
  borderHover: "#cbc7c2",
  accent: "#b35017",
  accentHover: "#9a4310",
  accentActive: "#85390c",
  selection: "#a9998f2b",
  hover: "#0000000d",
  active: "#00000014",
  focus: "#b35017",
  error: "#b7493f",
  warning: "#8d6c15",
  success: "#5f8d3d",
  info: "#2d72c4",
};
const OMMS_DARK: ThemeColours = {
  canvas: "#120f0e",
  elevated: "#181715",
  muted: "#171615",
  text: "#c9c5ba",
  textSecondary: "#8f8b81",
  border: "#242323",
  borderHover: "#504e4c",
  accent: "#da7c47",
  accentHover: "#eb8c57",
  accentActive: "#fd9b66",
  selection: "#c8c6c52b",
  hover: "#ffffff12",
  active: "#ffffff1f",
  focus: "#da7c47",
  error: "#da5b4a",
  warning: "#c67f13",
  success: "#76ad4f",
  info: "#479fe6",
};

export const THEMES: readonly ThemeDefinition[] = [
  { id: DEFAULT_LIGHT_THEME, name: "OMMS", variant: "light", colours: OMMS_LIGHT },
  { id: DEFAULT_DARK_THEME, name: "OMMS", variant: "dark", colours: OMMS_DARK },
  ...THEME_DATA,
];

export function themesOf(variant: ThemeVariant): ThemeDefinition[] {
  return THEMES.filter((theme) => theme.variant === variant);
}

/** The theme with this id and variant, or the OMMS theme of that variant. */
export function findTheme(id: string, variant: ThemeVariant): ThemeDefinition {
  const fallback = variant === "light" ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
  return (
    THEMES.find((theme) => theme.id === id && theme.variant === variant) ??
    THEMES.find((theme) => theme.id === fallback)!
  );
}

export function isDefaultTheme(theme: ThemeDefinition): boolean {
  return theme.id === DEFAULT_LIGHT_THEME || theme.id === DEFAULT_DARK_THEME;
}

const label = (token: string) => `color-mix(in srgb, var(${token}) 75%, var(--foreground))`;

/**
 * Every OMMS colour token a theme sets. Labels mix a colour with the text colour.
 * The focus ring uses the accent: some theme focus colours are mostly transparent.
 */
export function themeTokens(colours: ThemeColours, variant: ThemeVariant): Record<string, string> {
  const onAccent = variant === "light" ? "#ffffff" : colours.canvas;
  return {
    "--background": colours.canvas,
    "--foreground": colours.text,
    "--card": colours.elevated,
    "--card-foreground": colours.text,
    "--popover": colours.elevated,
    "--popover-foreground": colours.text,
    "--primary": colours.accent,
    "--primary-foreground": onAccent,
    "--primary-hover": colours.accentHover,
    "--primary-active": colours.accentActive,
    "--primary-label": "color-mix(in srgb, var(--primary) 70%, var(--foreground))",
    "--secondary": colours.muted,
    "--secondary-foreground": colours.text,
    "--muted": colours.muted,
    "--muted-foreground": colours.textSecondary,
    "--accent": colours.selection,
    "--accent-foreground": colours.text,
    "--selection": colours.selection,
    "--interactive-hover": colours.hover,
    "--interactive-active": colours.active,
    "--destructive": colours.error,
    "--destructive-label": label("--destructive"),
    "--border": colours.border,
    "--border-hover": colours.borderHover,
    "--input": "color-mix(in srgb, var(--muted-foreground) 75%, var(--background))",
    "--ring": colours.accent,
    "--status-warning": colours.warning,
    "--status-warning-label": label("--status-warning"),
    "--status-success": colours.success,
    "--status-success-label": label("--status-success"),
    "--status-info": colours.info,
    "--status-info-label": label("--status-info"),
    "--chart-1": colours.accent,
    "--chart-2": colours.success,
    "--chart-3": colours.info,
    "--chart-4": colours.warning,
    "--chart-5": colours.error,
    "--sidebar": colours.muted,
    "--sidebar-foreground": colours.text,
    "--sidebar-primary": colours.accent,
    "--sidebar-primary-foreground": onAccent,
    "--sidebar-accent": colours.selection,
    "--sidebar-accent-foreground": colours.text,
    "--sidebar-border": colours.border,
    "--sidebar-ring": colours.accent,
  };
}

function block(selector: string, tokens: Record<string, string>): string {
  const lines = Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/**
 * The rules for the chosen themes. OMMS marks dark mode with a `dark` class on
 * `<html>`; these selectors are more specific than `:root` and `.dark` in app.css,
 * so they win in any order. A default theme adds no rule.
 */
export function themeStylesheet(lightId: string, darkId: string): string {
  const light = findTheme(lightId, "light");
  const dark = findTheme(darkId, "dark");
  const rules: string[] = [];
  if (!isDefaultTheme(light))
    rules.push(block(":root:not(.dark)", themeTokens(light.colours, "light")));
  if (!isDefaultTheme(dark)) rules.push(block(":root.dark", themeTokens(dark.colours, "dark")));
  return rules.join("\n");
}
