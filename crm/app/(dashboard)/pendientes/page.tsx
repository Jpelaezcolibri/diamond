// "Para atender" — inicio del asesor (App de asesores F1, 2026-10-07; idea
// tomada de Innoarte: los pendientes se calculan de los datos y desaparecen
// solos cuando se resuelven). Tres listas:
//   1. Visitas por confirmar que hoy son suyas (rotacion), con el corte.
//   2. Pedidos de contacto (notificaciones asesor_solicitado sin leer).
//   3. Sus leads en conversacion sin movimiento hace mas de 2 h.
// El admin ve las visitas por confirmar de todo el equipo.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { miAsesor, filtroMisLeads } from "@/lib/mi-asesor";
import ActivarNotificaciones from "@/components/activar-notificaciones";

export const dynamic = "force-dynamic";

type Cita = { estado?: string; fecha_hora?: string; ref?: string; asesor_id?: string; corte_at?: string; descripcion?: string };
type LeadCita = { id: string; nombre: string | null; phone: string; source: string | null; cita: Cita | null };
type LeadQuieto = { id: string; nombre: string | null; phone: string; updated_at: string; estado: string };
type Nota = { id: string; titulo: string; cuerpo: string | null; link: string | null; created_at: string };

const fmt = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "sin fecha";

export default async function PendientesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);
  const asesor = await miAsesor(supabase, user);

  const { data: conCita } = await supabase
    .from("leads")
    .select("id, nombre, phone, source, cita")
    .not("cita", "is", null)
    .limit(500);
  const porConfirmar = ((conCita as LeadCita[]) || [])
    .filter((l) => l.cita && l.cita.estado === "propuesta" && (admin || (asesor && l.cita.asesor_id === asesor.id)))
    .sort((a, b) => String(a.cita?.fecha_hora).localeCompare(String(b.cita?.fecha_hora)));

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

  const vacio = porConfirmar.length === 0 && (notas || []).length === 0 && quietos.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Para atender{asesor?.alias_publico ? <span className="ml-2 text-base font-normal text-slate-500">· {asesor.alias_publico}</span> : null}
        </h1>
        {asesor && <ActivarNotificaciones />}
      </div>

      {vacio && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">No tenés nada pendiente. 🎉</p>}

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
                {l.cita?.corte_at && <div className="mt-1 text-xs text-amber-800">Confirmá antes de {fmt(l.cita.corte_at)} o se cancela</div>}
                <div className="mt-1 text-xs text-slate-500">Se confirma con el botón del WhatsApp o escribiéndole “OK CONFIRMADA” a Sofi.</div>
              </li>
            ))}
          </ul>
        </section>
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
