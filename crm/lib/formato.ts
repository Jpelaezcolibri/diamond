/**
 * Formato de precio, área y plurales para lo que el CRM muestra o deja copiar.
 *
 * RÉPLICA de src/lib/formato.js (el bot), igual que src/lib/slug.js replica
 * web/lib/slug.ts. Son tres apps con package.json separados y sin workspace, así
 * que no hay import cruzado posible; el precio de eso es esta copia. Si se toca
 * una, se toca la otra — y hay un test del lado del bot que congela el
 * comportamiento con los casos reales que motivaron el módulo.
 *
 * Por qué existe: la columna `precio` es TEXT y trae lo que alguien tecleó en
 * Wasi. El borrador que un asesor copia y pega en un grupo gremial es igual de
 * público que la respuesta automática, así que merece el mismo cuidado.
 */

/**
 * Toma el PRIMER grupo numérico, no todos los dígitos del texto.
 *
 * El bug que evita: `replace(/\D/g, "")` sobre "$450.000.000 negociable 2024"
 * pega todo y devuelve 4500000002024 — un entero válido, diez mil veces el
 * precio real, que no falla nunca y solo publica un disparate.
 */
export function parsearPrecio(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : null;

  const encontrado = raw.match(/\d[\d.,\s]*/);
  if (!encontrado) return null;
  const digitos = encontrado[0].replace(/[^\d]/g, "");
  if (!digitos) return null;

  let valor = Number(digitos);
  if (!Number.isSafeInteger(valor) || valor <= 0) return null;

  // "1.200 millones" -> 1.200.000.000, sin re-multiplicar un label ya expandido.
  if (/mill?[oó]n(?:es)?\b|\bmm\b/i.test(raw) && valor < 1_000_000) valor *= 1_000_000;
  return valor;
}

export function formatearPrecio(raw: string | number | null | undefined): string | null {
  const n = parsearPrecio(raw);
  return n === null ? null : `$${n.toLocaleString("es-CO")}`;
}

/** Acepta el formato pegado de Wasi ("186m2") y el decimal con coma. */
export function parsearArea(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw > 0 ? raw : null;
  const encontrado = raw.replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!encontrado) return null;
  const valor = Number(encontrado[0]);
  return valor > 0 ? valor : null;
}

export function formatearArea(raw: string | number | null | undefined): string | null {
  const n = parsearArea(raw);
  if (n === null) return null;
  const numero = Number.isInteger(n) ? n : Number(n.toFixed(1));
  return `${numero.toLocaleString("es-CO")} m²`;
}

/** "1 alcoba", no "1 alcobas". Devuelve null si no hay nada que decir. */
export function pluralizar(cantidad: number | null | undefined, singular: string, plural?: string): string | null {
  const n = Number(cantidad);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n} ${n === 1 ? singular : plural || `${singular}s`}`;
}

export const pluralAlcobas = (n: number | null | undefined) => pluralizar(n, "alcoba");
