import type { CanonicalProperty } from "./wasi-source.js";

/**
 * Campos que el sync refresca en CADA corrida, no solo cuando el diff detecta
 * un evento. Solo se escriben cuando la fuente TIENE el dato: si Wasi lo manda
 * vacio se conserva lo que haya en la fila (lo cargado a mano o por el import
 * de Excel), en vez de borrarlo. Asignar el mismo valor es idempotente y no
 * dispara eventos ni regeneracion de contenido.
 *
 * Garaje, estrato (2026-09-02), caracteristicas (2026-09-05) y administracion
 * (2026-09-13) ya seguian esta regla.
 *
 * Zona, ciudad, tipo, operacion, area, habitaciones y banos (2026-10-07): el
 * diff solo convierte en patch los cambios de precio, disponibilidad, texto y
 * fotos, asi que despues de la primera sincronizacion estos campos NUNCA se
 * actualizaban. Medido ese dia: 9495363 decia "La Catedral" en Wasi y nada en
 * la base; una propiedad sin zona no la puede ofrecer el motor de match.
 *
 * El link NO entra: Wasi lo arma hoy con el dominio de la cuenta
 * (diamondinmobiliaria.com), que sirve la landing; el link inmo.co guardado
 * abre directo. Cambiarlo es otra decision.
 */
export function camposQueSeRefrescan(data: CanonicalProperty): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const tiene = (v: unknown) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
  const campos = [
    "zona",
    "ciudad",
    "tipo",
    "operacion",
    "area",
    "habitaciones",
    "banos",
    "garaje",
    "estrato",
    "caracteristicas",
    "administracion"
  ] as const;
  for (const campo of campos) {
    const valor = (data as Record<string, unknown>)[campo];
    if (tiene(valor)) patch[campo] = valor;
  }
  return patch;
}
