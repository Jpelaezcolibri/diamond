import { Fraunces, Inter, Sora, Cormorant_Garamond, Manrope, Space_Grotesk } from "next/font/google";
import type { TenantConfig } from "./tenant-schema";

// ---------------------------------------------------------------------------
// Presets tipograficos. next/font exige llamadas estaticas en module scope,
// por eso los pares se declaran aqui y el tenant elige por nombre.
// Solo las variables del preset activo se aplican al <html>; las demas
// fuentes no generan preload.
// ---------------------------------------------------------------------------

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-heading-elegant",
  display: "swap",
  axes: ["opsz"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body-sans",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-heading-modern",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-heading-editorial",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body-manrope",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading-geometric",
  display: "swap",
});

type FontPreset = TenantConfig["theme"]["fontPreset"];

const presets: Record<FontPreset, { heading: { variable: string }; body: { variable: string }; headingVar: string; bodyVar: string }> = {
  elegant: { heading: fraunces, body: inter, headingVar: "--font-heading-elegant", bodyVar: "--font-body-sans" },
  modern: { heading: sora, body: inter, headingVar: "--font-heading-modern", bodyVar: "--font-body-sans" },
  editorial: { heading: cormorant, body: manrope, headingVar: "--font-heading-editorial", bodyVar: "--font-body-manrope" },
  geometric: { heading: spaceGrotesk, body: manrope, headingVar: "--font-heading-geometric", bodyVar: "--font-body-manrope" },
};

/** Clases + mapeo de variables del preset activo, para aplicar en el <html>. */
export function getFontPreset(preset: FontPreset) {
  const p = presets[preset];
  return {
    /** Clases que definen las variables de las fuentes del preset. */
    className: `${p.heading.variable} ${p.body.variable}`,
    /** CSS que conecta los tokens genericos del design system con el preset. */
    css: `:root{--font-heading:var(${p.headingVar});--font-body:var(${p.bodyVar});}`,
  };
}
