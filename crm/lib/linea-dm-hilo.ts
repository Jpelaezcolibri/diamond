// Identidad de un hilo de la línea de DM — separado de linea-dm-inbox.tsx
// (que es "use client") para que crm/lib/calendar-events.ts, que es código
// de servidor, pueda importar `anclaHilo` sin cruzar la frontera cliente ↔
// servidor. Es la ancla compartida entre el panel de /grupos y el link "ver
// chat" del Calendario del equipo — si uno cambia, el otro tiene que cambiar
// igual (Juan, 2026-09-08).

export type IdentidadHilo = { lid: string | null; telefono: string | null };

/** La clave del hilo: el lid si lo hay, si no el teléfono. Un lid y un
 *  teléfono con los mismos dígitos son dos personas distintas. */
export function claveHilo(m: { remitente_lid: string | null; remitente_telefono: string | null }): string | null {
  return m.remitente_lid || m.remitente_telefono || null;
}

/** id estable del anchor de un hilo — el mismo que usa calendar-events.ts
 *  para el link "ver chat" desde el Calendario del equipo. Sin el sufijo
 *  `@lid` para que sea un id de HTML válido.
 *
 *  `idRespaldo` es el id de la FILA de linea_dm, para cuando no hay ni lid
 *  ni teléfono (revisión final, 2026-09-08: con la migración
 *  2026-09-08_linea_dm_lid.sql pendiente, todos los DM que llegan por lid
 *  caen en este caso). Sin esto, todos esos hilos compartían el mismo
 *  ancla fija "dm-sin-identidad" — HTML inválido (ids repetidos) y el link
 *  "ver chat" del Calendario apuntando siempre al primero. Cada hilo sin
 *  identidad tiene exactamente un mensaje (agruparPorRemitente, en
 *  linea-dm-inbox.tsx, ya cae a `sin-identidad:${m.id}` como clave de
 *  agrupación), así que el id de ESE mensaje alcanza — y como los dos
 *  consumidores lo tienen a mano, no hace falta que sea opcional. */
export function anclaHilo(identidad: IdentidadHilo, idRespaldo: string): string {
  if (identidad.lid) return `dm-${identidad.lid.replace(/@lid$/, "")}`;
  if (identidad.telefono) return `dm-${identidad.telefono}`;
  return `dm-sin-identidad-${idRespaldo}`;
}
