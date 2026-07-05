import { premiumStripLayout } from "./premium-strip.js";
import type { LayoutFn } from "./types.js";

/**
 * Registro por `brand.layoutStyle` — hoy solo existe premium_strip; el
 * Brand Studio (F2) agregara nuevas entradas sin tocar el renderer.
 */
export const LAYOUTS: Record<string, LayoutFn> = {
  premium_strip: premiumStripLayout
};

export function resolveLayout(layoutStyle: string): LayoutFn {
  return LAYOUTS[layoutStyle] ?? premiumStripLayout;
}

export * from "./types.js";
