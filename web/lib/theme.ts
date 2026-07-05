import type { TenantConfig } from "@/config/tenant-schema";
import { ensureContrast } from "./contrast";

// ---------------------------------------------------------------------------
// Config del tenant → CSS variables (--ref-*). Se inyecta server-rendered en
// el <head> del root layout: cero FOUC, cero JS de theming.
// ---------------------------------------------------------------------------

const RADIUS: Record<TenantConfig["theme"]["radius"], string> = {
  none: "0px",
  sm: "0.375rem",
  md: "0.75rem",
  lg: "1rem",
};

type ColorTokens = TenantConfig["theme"]["colors"];

const TOKEN_NAMES: Record<keyof ColorTokens, string> = {
  background: "--ref-background",
  foreground: "--ref-foreground",
  surface: "--ref-surface",
  primary: "--ref-primary",
  primaryForeground: "--ref-primary-foreground",
  accent: "--ref-accent",
  accentForeground: "--ref-accent-foreground",
  muted: "--ref-muted",
  border: "--ref-border",
};

function block(colors: ColorTokens, mode: "light" | "dark"): string {
  const tokens = (Object.keys(TOKEN_NAMES) as (keyof ColorTokens)[])
    .map((key) => `${TOKEN_NAMES[key]}:${colors[key][mode]};`)
    .join("");

  // Variante de "accent" segura para texto (AA, 4.5:1). El accent de marca
  // suele ser un tono claro pensado para detalles (líneas, badges), no para
  // párrafos; en vez de exigir un segundo color por tenant, se deriva
  // oscureciendo automáticamente contra el fondo de esa misma paleta.
  const accentText = ensureContrast(colors.accent[mode], colors.background[mode], 4.5);

  return `${tokens}--ref-accent-text:${accentText};`;
}

export function buildThemeCss(theme: TenantConfig["theme"]): string {
  const root = `${block(theme.colors, "light")}--ref-radius:${RADIUS[theme.radius]};color-scheme:light;`;
  const dark = `${block(theme.colors, "dark")}color-scheme:dark;`;
  return `:root{${root}}.dark{${dark}}`;
}
