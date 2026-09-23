/**
 * El link de Wasi que se puede compartir. Espejo de `enlazarWasiPublico` del
 * bot (src/data/properties.js) — mantener los dos iguales.
 *
 * `properties.link` guarda el link crudo del sync, con el dominio de la
 * cuenta (paraisoinmobiliario.inmo.co). Ese sitio quedo suspendido por Wasi
 * (verificado 2026-09-23: la home y todas las fichas muestran "Página no
 * disponible en Wasi"), y el equipo copiaba el link del boton "Wasi ↗" del
 * CRM para pasarselo al colega: le llegaba roto. La misma ruta abre en el
 * dominio generico info.wasi.co, que ademas trae el boton de WhatsApp con
 * `?shared=whatsapp`. Un link que no es de Wasi (la ficha de la landing,
 * /propiedades/<titulo>-<ref>) sale tal cual.
 */
const HOST_WASI_PUBLICO = process.env.NEXT_PUBLIC_WASI_PUBLIC_HOST || "info.wasi.co";

// Dos segmentos y el ultimo todos digitos: /apartamento-venta-robledo-medellin/10013440
const RUTA_DE_WASI = /^\/[^/]+\/\d{4,}$/;

export function enlazarWasiPublico(link: string | null | undefined): string | null {
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  const esDominioWasi = url.hostname === "info.wasi.co" || url.hostname.endsWith(".inmo.co");
  if (!esDominioWasi && !RUTA_DE_WASI.test(url.pathname)) return link;
  url.hostname = HOST_WASI_PUBLICO;
  url.searchParams.set("shared", "whatsapp");
  return url.toString();
}
