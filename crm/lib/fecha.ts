// Formato de fechas del CRM, siempre en hora de Colombia.
//
// ═══ POR QUE ESTE MODULO EXISTE ═══
//
// `new Date(iso).toLocaleString("es-CO")` NO alcanza. El locale decide el
// idioma y el orden de los campos; la zona horaria la toma del reloj de quien
// ejecuta. Y buena parte del CRM son Server Components: quien ejecuta es
// Vercel, que corre en UTC. Resultado: todo se mostraba 5 horas adelantado —
// un mensaje de las 4:58 p. m. aparecia como 9:58 p. m., y un mensaje de la
// noche aparecia con la fecha del dia siguiente.
//
// Ademas los componentes de cliente tampoco se salvan: Next los renderiza
// primero en el servidor (UTC) y despues hidrata en el navegador (Bogota), lo
// que produce un parpadeo y un hydration mismatch.
//
// La zona se fija explicitamente y no se hereda de nadie. Diamond opera en
// Medellin; si algun dia hay tenants en otra zona, esto se resuelve por
// organizacion, no volviendo al comportamiento de "la zona del servidor".

export const ZONA = "America/Bogota";

const LOCALE = "es-CO";

function fmt(iso: string | null | undefined, opciones: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(LOCALE, { timeZone: ZONA, ...opciones }).format(d);
  } catch {
    return "";
  }
}

/** "4:58 p. m." */
export const hora = (iso: string | null | undefined) =>
  fmt(iso, { hour: "2-digit", minute: "2-digit" });

/** "28/07/2026" */
export const fecha = (iso: string | null | undefined) =>
  fmt(iso, { day: "2-digit", month: "2-digit", year: "numeric" });

/** "28/07/2026, 4:58 p. m." */
export const fechaHora = (iso: string | null | undefined) =>
  fmt(iso, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "28 de julio de 2026, 4:58 p. m." */
export const fechaHoraLarga = (iso: string | null | undefined) =>
  fmt(iso, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "28 de julio de 2026" */
export const fechaLarga = (iso: string | null | undefined) =>
  fmt(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * El dia calendario en Bogota, como "2026-07-28".
 *
 * Sirve para agrupar y comparar dias. NO usar `getDate()`/`getFullYear()` para
 * esto: leen el reloj del runtime, asi que en Vercel un mensaje de las 8 p. m.
 * de Medellin cae en el dia siguiente.
 */
export const diaEnBogota = (iso?: string | null): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(iso ? new Date(iso) : new Date());
