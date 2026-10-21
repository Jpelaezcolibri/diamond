// Tiempo que le queda a una visita por confirmar, y si ya vencio (brief
// citas-avisos §1 y §4, Juan 2026-10-21). Espejo de la escalera del bot
// (src/scheduler/citas-escalera.js): cada 60 min desde `asignada_at` pasa a la
// siguiente asesora, de 20:00 a 08:00 (Bogota) se pausa, y en `corte_at` se
// cancela aunque sea de noche.
// Hoja: sin imports "@/" para que la suite del bot (node --test) la importe
// directo, igual que crm/lib/publicaciones.ts.

export type CitaTiempo = {
  estado?: string | null;
  fecha_hora?: string | null;
  asignada_at?: string | null;
  corte_at?: string | null;
};

const MIN = 60 * 1000;
const BOGOTA_OFFSET_MS = 5 * 60 * MIN; // UTC-5 fijo, Colombia no tiene horario de verano
export const PASO_MIN = 60;
export const URGENTE_MIN = 15;

// Mismos estados crudos que src/lib/citas-vencidas.js.
export const ESTADOS_PENDIENTES = ["solicitada", "propuesta", "por_confirmar"];

// Una cita que nadie confirmo y cuya hora ya paso: no se muestra como
// "por confirmar", aunque el bot todavia no la haya marcado vencida.
export function vencidaSinConfirmar(cita: CitaTiempo | null | undefined, ahoraMs: number): boolean {
  if (!cita || !ESTADOS_PENDIENTES.includes(String(cita.estado))) return false;
  const t = new Date(cita.fecha_hora || "").getTime();
  return !isNaN(t) && t <= ahoraMs;
}

// Si `ms` cae en la pausa nocturna (20:00-08:00 Bogota), la proxima 08:00.
export function fueraDePausa(ms: number): number {
  const local = new Date(ms - BOGOTA_OFFSET_MS);
  const h = local.getUTCHours();
  if (h >= 8 && h < 20) return ms;
  const dia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (h >= 20 ? 1 : 0), 8, 0, 0);
  return dia + BOGOTA_OFFSET_MS;
}

export function duracion(min: number): string {
  if (min <= 0) return "unos instantes";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export type TiempoRestante = { texto: string; urgente: boolean; evento: "rotar" | "cortar"; minutos: number };

// null si no hay contador que mostrar: cita que no esta por confirmar, ya
// vencida, o vieja (sin asignada_at ni corte_at).
export function tiempoRestante(cita: CitaTiempo | null | undefined, ahoraMs: number, pasoMin: number = PASO_MIN): TiempoRestante | null {
  if (!cita || cita.estado !== "propuesta") return null;
  if (vencidaSinConfirmar(cita, ahoraMs)) return null;
  const asignada = new Date(cita.asignada_at || "").getTime();
  const corte = new Date(cita.corte_at || "").getTime();
  const hayAsignada = !isNaN(asignada);
  const hayCorte = !isNaN(corte);
  if (!hayAsignada && !hayCorte) return null;

  let paso = hayAsignada ? Math.max(asignada + pasoMin * MIN, ahoraMs) : NaN;
  if (!isNaN(paso)) paso = fueraDePausa(paso);

  const cortaPrimero = hayCorte && (isNaN(paso) || corte <= paso);
  const objetivo = cortaPrimero ? corte : paso;
  const minutos = Math.max(0, Math.ceil((objetivo - ahoraMs) / MIN));
  const texto = cortaPrimero ? `Se cancela en ${duracion(minutos)}` : `Pasa a la siguiente asesora en ${duracion(minutos)}`;
  return { texto, urgente: minutos < URGENTE_MIN, evento: cortaPrimero ? "cortar" : "rotar", minutos };
}
