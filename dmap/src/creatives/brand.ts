import { getDefaultBrandProfile } from "../repositories/brand-profiles.repo.js";
import type { BrandProfileRow } from "../repositories/types.js";

export interface BrandProfile {
  name: string;
  logoUrl: string | null;
  colors: { primary: string; accent: string; text: string };
  fonts: { heading: string; body: string };
  layoutStyle: string;
}

/** Brand por defecto de Diamond — respaldo si brand_profiles aun no esta poblada para la org. */
const DIAMOND_FALLBACK: BrandProfile = {
  name: "Diamond",
  logoUrl: null,
  colors: { primary: "#0b1526", accent: "#c9a24b", text: "#ffffff" },
  fonts: { heading: "Playfair Display", body: "Inter" },
  layoutStyle: "premium_strip"
};

function toBrandProfile(row: BrandProfileRow): BrandProfile {
  return {
    name: row.name,
    logoUrl: row.logo_url,
    colors: row.colors,
    fonts: row.fonts,
    layoutStyle: row.layout_style
  };
}

/** Resuelve el brand profile por defecto de una org, con fallback a la identidad de Diamond. */
export async function resolveBrandProfile(orgId: string): Promise<BrandProfile> {
  const row = await getDefaultBrandProfile(orgId);
  return row ? toBrandProfile(row) : DIAMOND_FALLBACK;
}
