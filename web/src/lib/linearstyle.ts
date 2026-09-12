// Linear custom-theme strings → this app's design tokens.
//
// Linear (and linear.style) express a theme as six comma-separated hex colors
// in a fixed slot order: base background, base text, sidebar background,
// sidebar text, accent, accent text. Every token the stylesheet exposes is
// derived from those six here, so pasting the same string into Linear and
// into Settings yields the same look. Pure: no DOM, no React — the provider
// in theme.tsx applies the result.

export interface LinearTheme {
  base: string;
  text: string;
  sidebar: string;
  sidebarText: string;
  accent: string;
  accentText: string;
}

export const LINEAR_THEME_EXAMPLE = "#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#FFFFFF";

const HEX = /^#?([0-9a-f]{6})$/i;

// Parse a pasted theme string. Tolerates whitespace and missing '#'; returns
// null for anything that is not exactly six 6-digit hex colors.
export function parseLinearTheme(raw: string): LinearTheme | null {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== 6) return null;
  const hex: string[] = [];
  for (const p of parts) {
    const m = HEX.exec(p);
    if (!m) return null;
    hex.push(`#${m[1].toUpperCase()}`);
  }
  const [base, text, sidebar, sidebarText, accent, accentText] = hex;
  return { base, text, sidebar, sidebarText, accent, accentText };
}

// The canonical string form, the same one the server stores.
export function formatLinearTheme(t: LinearTheme): string {
  return [t.base, t.text, t.sidebar, t.sidebarText, t.accent, t.accentText].join(",");
}

// WCAG relative luminance of a #RRGGBB color, 0 (black) … 1 (white).
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

// A theme is dark when its base background is. This picks which variant of
// the status palette (success/warning/destructive/priority) sits on top of it.
export function isDarkTheme(t: LinearTheme): boolean {
  return luminance(t.base) < 0.4;
}

const mix = (a: string, pct: number, b: string) => `color-mix(in oklab, ${a} ${pct}%, ${b})`;

// Every custom property the stylesheet's @theme block reads, as the provider
// sets them on <html>. Neutrals come from base/text, chrome from the sidebar
// pair, primary from the accent pair; the semantic status colors are left to
// the light/dark defaults chosen by isDarkTheme.
export function themeVars(t: LinearTheme): Record<string, string> {
  const dark = isDarkTheme(t);
  // Dark bases lift surfaces toward the text; light ones barely move.
  const lift = dark ? 6 : 0;
  return {
    "--background": t.base,
    "--foreground": t.text,
    "--card": mix(t.text, lift, t.base),
    "--card-foreground": t.text,
    "--popover": mix(t.text, lift + 2, t.base),
    "--popover-foreground": t.text,
    "--surface": mix(t.text, lift, t.base),
    "--surface-2": mix(t.sidebar, 70, t.base),
    "--secondary": mix(t.sidebar, 55, t.base),
    "--secondary-foreground": t.text,
    "--muted": mix(t.sidebar, 45, t.base),
    "--muted-foreground": mix(t.text, 64, t.base),
    "--accent": mix(t.sidebar, 60, t.base),
    "--accent-foreground": t.text,
    "--border": mix(t.text, dark ? 14 : 11, t.base),
    "--input": mix(t.text, dark ? 20 : 16, t.base),
    "--primary": t.accent,
    "--primary-foreground": t.accentText,
    "--ring": t.accent,
    "--chart-5": t.accent,
    "--chrome": t.sidebar,
    "--chrome-foreground": t.sidebarText,
    "--shadow-glow-value": `0 0 0 4px ${mix(t.accent, 20, "transparent")}`,
  };
}

// The names themeVars sets — what the provider clears when the override goes.
export const THEME_VAR_NAMES = Object.keys(
  themeVars({ base: "#000000", text: "#FFFFFF", sidebar: "#000000", sidebarText: "#FFFFFF", accent: "#000000", accentText: "#FFFFFF" }),
);

// The six swatches in slot order, labelled the way Linear labels them.
export function themeSwatches(t: LinearTheme): { label: string; hex: string }[] {
  return [
    { label: "Base", hex: t.base },
    { label: "Text", hex: t.text },
    { label: "Sidebar", hex: t.sidebar },
    { label: "Sidebar text", hex: t.sidebarText },
    { label: "Accent", hex: t.accent },
    { label: "Accent text", hex: t.accentText },
  ];
}
