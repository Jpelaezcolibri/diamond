import { createClient } from "@/lib/supabase/server";
import { getTeamRoster } from "@/lib/team";

export const dynamic = "force-dynamic";

// Cita tal como la guarda el bot en leads.cita (jsonb). advisor_id se estampa
// al agendar con hora validada; puede faltar en citas viejas (flujo anterior).
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

const TIPO_LABEL: Record<string, string> = {
  visita: "Visita",
  llamada: "Llamada",
  asesoria: "Asesoría",
};

// Paleta estable por asesor: el color sale del hash del id, asi cada asesor
// mantiene su color entre renders sin guardarlo en ningun lado.
const ADVISOR_COLORS = [
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-sky-100 text-sky-800 border-sky-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-violet-100 text-violet-800 border-violet-200",
];
function colorFor(id: string | null): string {
  if (!id) return "bg-slate-100 text-slate-600 border-slate-200";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ADVISOR_COLORS[h % ADVISOR_COLORS.length];
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default async function CalendarioPage() {
  const supabase = await createClient();

  const [{ data }, roster] = await Promise.all([
    supabase
      .from("leads")
      .select("id, nombre, phone, property_ref_origen, cita")
      .not("cita", "is", null)
      .limit(500),
    getTeamRoster(),
  ]);

  // Solo citas con fecha/hora concreta y futuras o de hoy en adelante — el
  // calendario es agenda, no historial.
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);
  const leads = ((data || []) as LeadConCita[])
    .filter((l) => l.cita?.fecha_hora && new Date(l.cita.fecha_hora) >= hoyInicio)
    .sort((a, b) => new Date(a.cita!.fecha_hora!).getTime() - new Date(b.cita!.fecha_hora!).getTime());

  const groups = new Map<string, LeadConCita[]>();
  for (const l of leads) {
    const key = dayKey(l.cita!.fecha_hora!);
    groups.set(key, [...(groups.get(key) || []), l]);
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Calendario del equipo</h1>
      <p className="mb-6 text-sm text-slate-500">
        Visitas, llamadas y asesorías agendadas con clientes. El color indica el asesor asignado.
      </p>

      {groups.size === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No hay citas próximas agendadas.
        </p>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([day, items]) => (
            <div key={day}>
              <h3 className="mb-2 text-sm font-semibold capitalize text-slate-700">{day}</h3>
              <ul className="space-y-2">
                {items.map((l) => {
                  const asesor = l.cita?.advisor_id ? roster[l.cita.advisor_id]?.nombre : null;
                  return (
                    <li
                      key={l.id}
                      className={`flex items-center justify-between rounded-2xl border bg-white p-3.5 shadow-sm ${colorFor(l.cita?.advisor_id ?? null)}`}
                    >
                      <div>
                        <p className="font-medium">
                          {TIPO_LABEL[l.cita?.tipo || ""] || "Cita"} · {l.nombre || `+${l.phone}`}
                        </p>
                        <p className="text-xs opacity-80">
                          {l.property_ref_origen ? `Propiedad ${l.property_ref_origen} · ` : ""}
                          {asesor ? `Asesor: ${asesor}` : "Sin asesor asignado"}
                        </p>
                      </div>
                      <span className="text-sm font-semibold">
                        {new Date(l.cita!.fecha_hora!).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
