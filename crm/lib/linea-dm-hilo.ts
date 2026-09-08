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
 *  `@lid` para que sea un id de HTML válido. */
export function anclaHilo(identidad: IdentidadHilo): string {
  if (identidad.lid) return `dm-${identidad.lid.replace(/@lid$/, "")}`;
  if (identidad.telefono) return `dm-${identidad.telefono}`;
  return "dm-sin-identidad";
}
