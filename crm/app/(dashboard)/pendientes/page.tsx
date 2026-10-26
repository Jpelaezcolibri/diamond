// "Para atender" — inicio del asesor (App de asesores F1, 2026-10-07; idea
// tomada de Innoarte: los pendientes se calculan de los datos y desaparecen
// solos cuando se resuelven). Cuatro listas:
//   0. Sus propiedades por renovar (vencen en 5 dias o menos; Juan, 2026-10-20).
//   1. Visitas por confirmar que hoy son suyas (rotacion), con el corte y el
//      tiempo que les queda; las que ya pasaron sin confirmar van aparte,
//      colapsadas, con boton para descartarlas (2026-10-21).
//   2. Pedidos de contacto (notificaciones asesor_solicitado sin leer).
//   3. Sus leads en conversacion sin movimiento hace mas de 2 h.
// El admin ve las visitas por confirmar de todo el equipo.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { miAsesor, filtroMisLeads } from "@/lib/mi-asesor";
import ActivarNotificaciones from "@/components/activar-notificaciones";
import RenovarPropiedad, { type PropiedadPorRenovar } from "@/components/renovar-propiedad";
import { formatearPrecio } from "@/lib/formato";
import { vencidaSinConfirmar } from "@/lib/cita-tiempo";
import TiempoCita from "@/components/tiempo-cita";
import DescartarCita from "@/components/descartar-cita";
import PreguntaPendiente, { type Pregunta } from "@/components/pregunta-pendiente";
import { enlazarWasiPublico } from "@/lib/wasi-link";

export const dynamic = "force-dynamic";

type Cita = { estado?: string; fecha_hora?: string; ref?: string; asesor_id?: string; advisor_id?: string; corte_at?: string; asignada_at?: string; descripcion?: string };
type LeadCita = { id: string; nombre: string | null; phone: string; source: string | null; cita: Cita | null };
type LeadQuieto = { id: string; nombre: string | null; phone: string; updated_at: string; estado: string };
type Nota = { id: string; titulo: string; cuerpo: string | null; link: string | null; created_at: string };

const fmt = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "sin fecha";

type PropRow = { ref: string; titulo: string | null; precio: string | null; images: string[] | null; link: string | null; vence_at: string; periodo_precio?: string | null };

const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "long" }).format(new Date(iso));

const PERIODO: Record<string, string> = { mensual: "mensual", diario: "por noche", semanal: "por semana" };

// Solo las del propio captador. Si falla (p. ej. antes de la migracion de
// origen/vence_at) la lista queda vacia y la pagina sigue.
async function propiedadesPorRenovar(supabase: Awaited<ReturnType<typeof createClient>>, asesorId: string): Promise<PropiedadPorRenovar[]> {
  const limite = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const consulta = (cols: string) =>
    supabase
      .from("properties")
      .select(cols)
      .eq("origen", "asesor")
      .eq("captador_id", asesorId)
      .eq("disponible", true)
      .lte("vence_at", limite)
      .order("vence_at", { ascending: true })
      .limit(50);
  let res = await consulta("ref, titulo, precio, images, link, vence_at, periodo_precio");
  // periodo_precio viene de otra migracion: sin ella se muestra sin periodo.
  if (res.error) res = await consulta("ref, titulo, precio, images, link, vence_at");
  if (res.error || !res.data) return [];
  const nueva = fechaLarga(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
  return (res.data as unknown as PropRow[]).map((r) => ({
    ref: r.ref,
    titulo: r.titulo,
    precio: formatearPrecio(r.precio),
    periodo: r.periodo_precio ? PERIODO[r.periodo_precio] || null : null,
    foto: r.images && r.images.length > 0 ? r.images[0] : null,
    link: r.link,
    venceTexto: fechaLarga(r.vence_at),
    nuevaVigenciaTexto: nueva,
  }));
}

export default async function PendientesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);
  const asesor = await miAsesor(supabase, user);

  const porRenovar = asesor ? await propiedadesPorRenovar(supabase, asesor.id) : [];

  const { data: conCita } = await supabase
    .from("leads")
    .select("id, nombre, phone, source, cita")
    .not("cita", "is", null)
    .limit(500);
  const ahora = Date.now();
  // Las viejas (sin asesor_id, de antes de la rotacion) son de quien tenia el
  // advisor_id (auth del CRM).
  const esMia = (c: Cita) => admin || Boolean(asesor && c.asesor_id === asesor.id) || Boolean(user && !c.asesor_id && c.advisor_id === user.id);
  const porFecha = (a: LeadCita, b: LeadCita) => String(a.cita?.fecha_hora).localeCompare(String(b.cita?.fecha_hora));
  const citas = (conCita as LeadCita[]) || [];
  // Una cita cuya hora ya paso no se muestra como "por confirmar", aunque el
  // bot todavia no la haya marcado vencida.
  const porConfirmar = citas
    .filter((l) => l.cita && l.cita.estado === "propuesta" && !vencidaSinConfirmar(l.cita, ahora) && esMia(l.cita))
    .sort(porFecha);
  const vencidas = citas.filter((l) => l.cita && vencidaSinConfirmar(l.cita, ahora) && esMia(l.cita)).sort(porFecha);

  // Preguntas de colegas al asesor (spec 2026-10-25): pendientes, y las
  // respondidas que no se pudieron entregar (menos las que esperan la ventana).
  // Si la tabla aun no existe, la consulta falla y la seccion no se pinta.
  const { data: filasPreguntas } = await supabase
    .from("preguntas_asesor")
    .select("id, ref, pregunta, estado, asignada_at, created_at, respuesta, respondida_por, entrega_error, asesor_id, lead:leads(id, nombre, phone, source)")
    .or("estado.eq.pendiente,and(estado.eq.respondida,entrega_error.neq.esperando_ventana)")
    .order("created_at", { ascending: true })
    .limit(50);
  type FilaPregunta = Omit<Pregunta, "asesor" | "fichaUrl" | "chatId"> & { asesor_id: string | null };
  const filas = (filasPreguntas as unknown as FilaPregunta[]) || [];
  let preguntas: Pregunta[] = [];
  if (filas.length > 0) {
    const refs = [...new Set(filas.map((f) => f.ref).filter((r): r is string => Boolean(r)))];
    const leadIds = [...new Set(filas.map((f) => f.lead?.id).filter((r): r is string => Boolean(r)))];
    const [{ data: asesoresTodos }, { data: props }, { data: convs }] = await Promise.all([
      supabase.from("advisors").select("id, name"),
      refs.length ? supabase.from("properties").select("ref, link").in("ref", refs) : Promise.resolve({ data: [] }),
      leadIds.length ? supabase.from("conversations").select("id, lead_id").in("lead_id", leadIds) : Promise.resolve({ data: [] }),
    ]);
    const nombreAsesor = new Map(((asesoresTodos as { id: string; name: string }[]) || []).map((a) => [a.id, a.name]));
    const linkDe = new Map(((props as { ref: string; link: string | null }[]) || []).map((x) => [x.ref, enlazarWasiPublico(x.link)]));
    const chatDe = new Map(((convs as { id: string; lead_id: string }[]) || []).map((c) => [c.lead_id, c.id]));
    preguntas = filas.map((f) => ({
      ...f,
      asesor: f.asesor_id ? nombreAsesor.get(f.asesor_id) || null : null,
      fichaUrl: f.ref ? linkDe.get(f.ref) || null : null,
      chatId: f.lead?.id ? chatDe.get(f.lead.id) || null : null,
    }));
  }

  const { data: notas } = asesor
    ? await supabase
        .from("notificaciones")
        .select("id, titulo, cuerpo, link, created_at")
        .eq("advisor_id", asesor.id)
        .eq("tipo", "asesor_solicitado")
        .is("leida_at", null)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  let quietos: LeadQuieto[] = [];
  if (user && !admin) {
    const hace2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("leads")
      .select("id, nombre, phone, updated_at, estado")
      .or(filtroMisLeads(user.id, asesor))
      .in("estado", ["en_conversacion", "calificado", "transferido"])
      .lt("updated_at", hace2h)
      .order("updated_at", { ascending: true })
      .limit(20);
    quietos = (data as LeadQuieto[]) || [];
  }

  const vacio = porRenovar.length === 0 && preguntas.length === 0 && porConfirmar.length === 0 && (notas || []).length === 0 && quietos.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Para atender{asesor?.alias_publico ? <span className="ml-2 text-base font-normal text-slate-500">· {asesor.alias_publico}</span> : null}
        </h1>
        {asesor && <ActivarNotificaciones />}
      </div>

      {vacio && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">No tenés nada pendiente. 🎉</p>}

      {porRenovar.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Tus propiedades por renovar ({porRenovar.length})</h2>
          <ul className="space-y-2">
            {porRenovar.map((p) => (
              <RenovarPropiedad key={p.ref} p={p} />
            ))}
          </ul>
        </section>
      )}

      {preguntas.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Preguntas de colegas ({preguntas.length})</h2>
          <ul className="space-y-2">
            {preguntas.map((p) => (
              <PreguntaPendiente key={p.id} p={p} />
            ))}
          </ul>
        </section>
      )}

      {porConfirmar.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Visitas por confirmar ({porConfirmar.length})</h2>
          <ul className="space-y-2">
            {porConfirmar.map((l) => (
              <li key={l.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="font-medium text-slate-900">
                  {l.nombre || `+${l.phone}`} {l.source === "colega" && <span className="text-xs text-slate-500">(colega)</span>}
                </div>
                <div className="text-sm text-slate-700">
                  {fmt(l.cita?.fecha_hora)}
                  {l.cita?.ref ? ` · ref ${l.cita.ref}` : ""}
                </div>
                {l.cita?.corte_at && <div className="mt-1 text-xs text-amber-800">Confírmala antes de {fmt(l.cita.corte_at)} o se cancela</div>}
                <TiempoCita cita={l.cita} />
                <div className="mt-1 text-xs text-slate-500">Se confirma con el botón del WhatsApp o escribiéndole “OK CONFIRMADA” a Sofi.</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {vencidas.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Vencidas sin confirmar ({vencidas.length})
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {vencidas.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <span className="text-slate-700">
                  <span className="font-medium text-slate-800">{l.nombre || `+${l.phone}`}</span>
                  {l.source === "colega" && <span className="text-xs text-slate-500"> (colega)</span>}
                  <span className="text-slate-500">
                    {" "}
                    · {fmt(l.cita?.fecha_hora)}
                    {l.cita?.ref ? ` · ref ${l.cita.ref}` : ""}
                  </span>
                </span>
                <DescartarCita leadId={l.id} />
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">Ya pasó la hora y nadie las confirmó. Descartarlas no le escribe a nadie.</p>
        </details>
      )}

      {(notas || []).length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Te pidieron hablar con un asesor</h2>
          <ul className="space-y-2">
            {((notas as Nota[]) || []).map((n) => (
              <li key={n.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <Link href={n.link || "/inbox"} className="font-medium text-slate-900 hover:underline">
                  🙋 {n.titulo}
                </Link>
                {n.cuerpo && <div className="text-sm text-slate-600">{n.cuerpo}</div>}
                <div className="text-xs text-slate-400">{fmt(n.created_at)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {quietos.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Tus leads sin movimiento hace más de 2 h</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {quietos.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="font-medium text-slate-800">{l.nombre || `+${l.phone}`}</span>
                <span className="text-xs text-slate-500">{fmt(l.updated_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
