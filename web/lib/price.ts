/**
 * Parsea precios almacenados como texto ("$800.000.000", "COP 2.200.000")
 * a numero en COP. Devuelve null si no hay digitos.
 */
export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Formatea un valor COP al estilo local: $800.000.000 */
export function formatPrice(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}

/** Version corta para chips/filtros: $800M, $1.550M, $2.2MM */
export function formatPriceShort(amount: number): string {
  if (amount >= 1_000_000_000) {
    const mm = amount / 1_000_000_000;
    return `$${Number.isInteger(mm) ? mm : mm.toFixed(1)}MM`;
  }
  if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
  return formatPrice(amount);
}

/** Extrae metros cuadrados de textos tipo "65m2", "210 m²". */
export function parseArea(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}
