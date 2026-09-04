// Unifica las fuentes de "eventos de calendario" del negocio en un solo tipo
// para el Calendario del equipo:
//  - leads.cita (jsonb): citas de CLIENTES agendadas desde el bot de WhatsApp
//    (src/agent/tools.js:agendar_cita).
//  - advisor_reminders con fecha_hora: recordatorios que un asesor le pidio a
//    Sofi-Comando y SI tienen dia/hora (los que no tienen fecha son notas
//    privadas y no entran aqui — quedan fuera por RLS ademas de por este filtro).
//  - linea_dm con avance detectado (Juan, 2026-08-21): un COLEGA de otra
//    inmobiliaria que confirmo fecha/hora de visita por la linea de Natalia
//    (src/groups/dm.js) — "todo lo que pase por Diamond que se pueda poner
//    como agendada la pones y la mides". Solo entran las que SI tienen
//    fecha (cita_fecha_hora_iso); "agendando"/"interes_avanzado" sin fecha
//    exacta no tienen donde caer en un calendario — esas se ven en el inbox.
import { getTeamRoster } from "@/lib/team";

export type CalendarEvent = {
  id: string;
  fechaHora: string;
  titulo: string;
  advisorId: string | null;
  advisorNombre: string | null;
  clienteNombre: string | null;
  propertyRef: string | null;
  origen: "cita_cliente" | "recordatorio_equipo" | "avance_colega";
  /** Link directo al hilo en el Inbox de la línea vinculada (Juan,
   *  2026-08-21: "la agenda quede marcada con el link directo al chat").
   *  Solo lo trae "avance_colega" — las citas de cliente y los recordatorios
   *  no tienen un chat de grupo al que volver. */
  linkChat: string | null;
  /** Sofi la agendó sola (src/agent/tools.js:agendar_cita, proximo_disponible)
   *  porque el cliente preguntó cuándo podía ver la propiedad sin proponer
   *  día/hora — nadie la revisó antes de confirmarla (Juan, 2026-08-21:
   *  "lo marcas para yo hacerle seguimiento"). Solo aplica a "cita_cliente". */
  autoAgendada: boolean;
  /** Estado de la cita (Juan, 2026-09-04). Una "propuesta" la pidió un colega
   *  y NADIE la confirmó todavía: no es un compromiso y el calendario tiene
   *  que decirlo. Las canceladas no llegan hasta acá — se filtran antes.
   *  Una cita vieja sin estado se lee como "confirmada": es lo que el equipo
   *  asumió todo este tiempo. */
  estado: "propuesta" | "confirmada";
};

type Cita = {
  descripcion?: string | null;
  fecha_hora?: string | null;
  tipo?: string | null;
  advisor_id?: string | null;
  origen?: string | null;
  estado?: string | null;
};

// Espejo de src/data/citas.js#estadoDe. Se duplica a propósito: el CRM no
// comparte código con el bot, y una cita sin estado —todas las que ya
// existen— tiene que leerse igual en los dos lados.
function estadoDeCita(cita: Cita | null): "propuesta" | "confirmada" | "cancelada" | "reprogramada" {
  const e = cita?.estado;
  if (e === "propuesta" || e === "cancelada" || e === "reprogramada") return e;
  return "confirmada";
}

type LeadConCita = {
  id: string;
  nombre: string | null;
  phone: string;
  property_ref_origen: string | null;
  cita: Cita | null;
};

type AdvisorReminder = {
  id: string;
  user_id: string;
  descripcion: string;
  fecha_hora: string | null;
};

type LineaDmAvance = {
  id: string;
  remitente_nombre: string | null;
  remitente_telefono: string | null;
  cita_fecha_hora_iso: string | null;
  avance_tipo: string | null;
  senal_id: string | null;
};

type GroupSignalRef = {
  id: string;
  matches: Array<{ ref?: string | null }> | null;
};

const TIPO_LABEL: Record<string, string> = {
  visita: "Visita",
  llamada: "Llamada",
  asesoria: "Asesoría",
};

// Inicio del dia de HOY en hora de Bogota (UTC-5 fijo, Colombia no tiene
// horario de verano), como Date en UTC equivalente — asi el filtro "de hoy
// en adelante" no depende de en que timezone corre el servidor (Vercel corre
// en UTC).
function bogotaTodayStart(): Date {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  return new Date(`${key}T00:00:00-05:00`);
}

// Clave YYYY-MM-DD en hora de Bogota (en-CA devuelve ese formato de fabrica).
export function bogotaDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(iso));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCalendarEvents(supabase: any): Promise<{
  events: CalendarEvent[];
  hasError: boolean;
  message: string | null;
}> {
  const [citasRes, remindersRes, dmRes, roster] = await Promise.all([
    supabase.from("leads").select("id, nombre, phone, property_ref_origen, cita").not("cita", "is", null).limit(500),
    supabase
      .from("advisor_reminders")
      .select("id, user_id, descripcion, fecha_hora")
      .not("fecha_hora", "is", null)
      .eq("completado", false)
      .limit(500),
    supabase
      .from("linea_dm")
      .select("id, remitente_nombre, remitente_telefono, cita_fecha_hora_iso, avance_tipo, senal_id")
      .eq("tiene_cita", true)
      .not("cita_fecha_hora_iso", "is", null)
      .limit(500),
    getTeamRoster(),
  ]);

  if (citasRes.error) console.error("[calendario:leads]", citasRes.error.message);
  if (remindersRes.error) console.error("[calendario:advisor_reminders]", remindersRes.error.message);
  // linea_dm es best-effort: si la migracion 2026-08-21_linea_dm.sql todavia
  // no corrio, el calendario sigue funcionando igual, solo sin esos eventos.
  if (dmRes.error && dmRes.error.code !== "42P01" && dmRes.error.code !== "PGRST205") {
    console.error("[calendario:linea_dm]", dmRes.error.message);
  }
  const mensajes = [citasRes.error?.message, remindersRes.error?.message].filter(Boolean) as string[];

  // Resolver el ref de cada avance via el pedido de grupo que el colega
  // publico — el mismo cruce que hace src/data/visitas.js del lado del bot.
  const idsSeñal = [...new Set(((dmRes.data as LineaDmAvance[]) || []).map((m) => m.senal_id).filter(Boolean))];
  const refPorSeñal = new Map<string, string | null>();
  if (idsSeñal.length) {
    const { data: señales } = await supabase.from("group_signals").select("id, matches").in("id", idsSeñal);
    for (const s of (señales as GroupSignalRef[]) || []) refPorSeñal.set(s.id, s.matches?.[0]?.ref ?? null);
  }

  const hoyInicio = bogotaTodayStart();

  // Un for en vez de filter+map: el estado se calcula una sola vez por lead y
  // decide dos cosas distintas (si el evento entra, y cómo se pinta).
  const citaEvents: CalendarEvent[] = [];
  for (const l of ((citasRes.data as LeadConCita[]) || [])) {
    if (!l.cita?.fecha_hora || new Date(l.cita.fecha_hora) < hoyInicio) continue;
    const estado = estadoDeCita(l.cita);
    if (estado === "cancelada") continue; // no se muestra: fue cancelada
    citaEvents.push({
      id: `lead:${l.id}`,
      fechaHora: l.cita.fecha_hora,
      titulo: `${TIPO_LABEL[l.cita?.tipo || ""] || "Cita"} · ${l.nombre || `+${l.phone}`}`,
      advisorId: l.cita?.advisor_id ?? null,
      advisorNombre: l.cita?.advisor_id ? roster[l.cita.advisor_id]?.nombre ?? null : null,
      clienteNombre: l.nombre,
      propertyRef: l.property_ref_origen,
      origen: "cita_cliente" as const,
      linkChat: null,
      autoAgendada: l.cita?.origen === "auto",
      // "reprogramada" ya trae la fecha nueva: es un compromiso vigente, se
      // pinta igual que una confirmada.
      estado: estado === "propuesta" ? "propuesta" : "confirmada",
    });
  }

  const reminderEvents: CalendarEvent[] = ((remindersRes.data as AdvisorReminder[]) || [])
    .filter((r) => r.fecha_hora && new Date(r.fecha_hora) >= hoyInicio)
    .map((r) => ({
      id: `reminder:${r.id}`,
      fechaHora: r.fecha_hora!,
      titulo: `Recordatorio · ${r.descripcion}`,
      advisorId: r.user_id,
      advisorNombre: roster[r.user_id]?.nombre ?? null,
      clienteNombre: null,
      propertyRef: null,
      linkChat: null,
      origen: "recordatorio_equipo" as const,
      autoAgendada: false,
      // Un recordatorio no tiene ciclo de vida propio: si existe, va.
      estado: "confirmada" as const,
    }));

  const avanceEvents: CalendarEvent[] = ((dmRes.data as LineaDmAvance[]) || [])
    .filter((m) => m.cita_fecha_hora_iso && new Date(m.cita_fecha_hora_iso) >= hoyInicio)
    .map((m) => ({
      id: `dm:${m.id}`,
      fechaHora: m.cita_fecha_hora_iso!,
      titulo: `Colega · ${m.remitente_nombre || m.remitente_telefono || "sin nombre"}`,
      advisorId: null,
      advisorNombre: null,
      clienteNombre: m.remitente_nombre,
      propertyRef: m.senal_id ? refPorSeñal.get(m.senal_id) ?? null : null,
      origen: "avance_colega" as const,
      // Mismo id de ancla que crm/components/linea-dm-inbox.tsx#anclaHilo —
      // si uno cambia, el otro tiene que cambiar igual.
      linkChat: `/grupos#dm-${m.remitente_telefono || "sin-telefono"}`,
      autoAgendada: false,
      // El colega ya confirmó fecha/hora por la línea: tampoco tiene estados.
      estado: "confirmada" as const,
    }));

  const events = [...citaEvents, ...reminderEvents, ...avanceEvents].sort(
    (a, b) => new Date(a.fechaHora).getTime() - new Date(b.fechaHora).getTime()
  );

  return { events, hasError: mensajes.length > 0, message: mensajes.join(" · ") || null };
}
