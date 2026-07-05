// ---------------------------------------------------------------------------
// Utilidades WCAG: contraste relativo y ajuste automático de un color hasta
// cumplir un ratio mínimo contra un fondo dado, preservando su matiz (hue).
// Se usa para derivar una variante "de texto" del accent de marca — el accent
// puede ser un dorado/verde claro pensado para detalles, no para texto; en
// vez de exigirle a cada tenant que declare dos tonos, el sistema oscurece
// uno automáticamente hasta que sea legible (AA, 4.5:1).
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Ratio de contraste WCAG entre dos colores hex (1:1 a 21:1). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  (r /= 255), (g /= 255), (b /= 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [255 * hue2rgb(p, q, h + 1 / 3), 255 * hue2rgb(p, q, h), 255 * hue2rgb(p, q, h - 1 / 3)];
}

/**
 * Oscurece (o aclara, si el fondo es oscuro) `hex` en pasos de luminosidad
 * HSL hasta alcanzar `targetRatio` de contraste contra `bgHex`, manteniendo
 * el matiz y la saturación. Si ya cumple, lo devuelve intacto.
 */
export function ensureContrast(hex: string, bgHex: string, targetRatio = 4.5): string {
  if (contrastRatio(hex, bgHex) >= targetRatio) return hex;

  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const bgLum = relativeLuminance(hexToRgb(bgHex));
  const darkening = bgLum > 0.5; // fondo claro → oscurecer; fondo oscuro → aclarar

  for (let i = 1; i <= 100; i++) {
    const step = darkening ? l - i / 100 : l + i / 100;
    if (step < 0 || step > 1) break;
    const candidate = rgbToHex(...hslToRgb(h, s, step));
    if (contrastRatio(candidate, bgHex) >= targetRatio) return candidate;
  }
  // Fallback extremo (no debería alcanzarse con colores de marca razonables).
  return darkening ? "#000000" : "#FFFFFF";
}
