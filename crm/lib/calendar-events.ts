// Unifica las dos fuentes de "eventos de calendario" del negocio en un solo
// tipo para el Calendario del equipo:
//  - leads.cita (jsonb): citas de CLIENTES agendadas desde el bot de WhatsApp
//    (src/agent/tools.js:agendar_cita).
//  - advisor_reminders con fecha_hora: recordatorios que un asesor le pidio a
//    Sofi-Comando y SI tienen dia/hora (los que no tienen fecha son notas
//    privadas y no entran aqui — quedan fuera por RLS ademas de por este filtro).
import { getTeamRoster } from "@/lib/team";

export type CalendarEvent = {
  id: string;
  fechaHora: string;
  titulo: string;
  advisorId: string | null;
  advisorNombre: string | null;
  clienteNombre: string | null;
  propertyRef: string | null;
  origen: "cita_cliente" | "recordatorio_equipo";
};

type Cita = {
  descripcion?: string | null;
  fecha_hora?: string | null;
  tipo?: string | null;
  advisor_id?: string | null;
};

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
  const [citasRes, remindersRes, roster] = await Promise.all([
    supabase.from("leads").select("id, nombre, phone, property_ref_origen, cita").not("cita", "is", null).limit(500),
    supabase
      .from("advisor_reminders")
      .select("id, user_id, descripcion, fecha_hora")
      .not("fecha_hora", "is", null)
      .eq("completado", false)
      .limit(500),
    getTeamRoster(),
  ]);

  if (citasRes.error) console.error("[calendario:leads]", citasRes.error.message);
  if (remindersRes.error) console.error("[calendario:advisor_reminders]", remindersRes.error.message);
  const mensajes = [citasRes.error?.message, remindersRes.error?.message].filter(Boolean) as string[];

  const hoyInicio = bogotaTodayStart();

  const citaEvents: CalendarEvent[] = ((citasRes.data as LeadConCita[]) || [])
    .filter((l) => l.cita?.fecha_hora && new Date(l.cita.fecha_hora) >= hoyInicio)
    .map((l) => ({
      id: `lead:${l.id}`,
      fechaHora: l.cita!.fecha_hora!,
      titulo: `${TIPO_LABEL[l.cita?.tipo || ""] || "Cita"} · ${l.nombre || `+${l.phone}`}`,
      advisorId: l.cita?.advisor_id ?? null,
      advisorNombre: l.cita?.advisor_id ? roster[l.cita.advisor_id]?.nombre ?? null : null,
      clienteNombre: l.nombre,
      propertyRef: l.property_ref_origen,
      origen: "cita_cliente" as const,
    }));

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
      origen: "recordatorio_equipo" as const,
    }));

  const events = [...citaEvents, ...reminderEvents].sort(
    (a, b) => new Date(a.fechaHora).getTime() - new Date(b.fechaHora).getTime()
  );

  return { events, hasError: mensajes.length > 0, message: mensajes.join(" · ") || null };
}
