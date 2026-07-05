import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/creatives/fonts.js -> ../../assets/fonts (assets se copia junto a dist, ver Dockerfile)
const FONTS_DIR = join(__dirname, "..", "..", "assets", "fonts");

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function loadFont(filename: string): ArrayBuffer {
  return toArrayBuffer(readFileSync(join(FONTS_DIR, filename)));
}

export interface SatoriFontConfig {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
}

let cachedFonts: SatoriFontConfig[] | null = null;

/**
 * Fuentes de marca embebidas para satori (ver dmap/ARCHITECTURE.md #6/#E).
 * Nota: satori no puede parsear las variable fonts originales de Google
 * Fonts (fvar incompatible con su fork de opentype.js) — estos TTF son
 * instancias estaticas generadas con `fonttools varLib.instancer` a partir
 * de Inter[opsz,wght].ttf y PlayfairDisplay[wght].ttf.
 */
export function getBrandFonts(): SatoriFontConfig[] {
  cachedFonts ??= [
    { name: "Playfair Display", data: loadFont("PlayfairDisplay-Regular.ttf"), weight: 400, style: "normal" },
    { name: "Playfair Display", data: loadFont("PlayfairDisplay-Bold.ttf"), weight: 700, style: "normal" },
    { name: "Inter", data: loadFont("Inter-Regular.ttf"), weight: 400, style: "normal" },
    { name: "Inter", data: loadFont("Inter-Bold.ttf"), weight: 700, style: "normal" }
  ];
  return cachedFonts;
}
