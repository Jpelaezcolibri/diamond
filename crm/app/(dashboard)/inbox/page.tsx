import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getTeamRoster } from "@/lib/team";
import { fetchSafe } from "@/lib/fetch-safe";
import { miAsesor, filtroMisLeads } from "@/lib/mi-asesor";
import { type Conversation } from "@/lib/types";
import InboxList from "@/components/inbox-list";
import ErrorBanner from "@/components/error-banner";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);
  // Solo lo mio (App de asesores F1): un asesor ve las conversaciones de SUS
  // leads (el filtro va sobre la tabla leads del join !inner).
  const asesor = admin ? null : await miAsesor(supabase, user);
  let consulta = supabase
    .from("conversations")
    .select("*, leads!inner(*)")
    .eq("estado", "activa")
    .neq("leads.source", "asesor");
  if (!admin && user) consulta = consulta.or(filtroMisLeads(user.id, asesor), { referencedTable: "leads" });

  const [{ data: conversations, hasError, message }, roster] = await Promise.all([
    fetchSafe<Conversation>(
      // !inner + neq("leads.source", "asesor"): las conversaciones entre Sofi
      // y el equipo (avisos del radar, reenvíos, recordatorios) viven en
      // /equipo desde el 2026-08-18 — sin este filtro se mezclaban acá con
      // los clientes reales, sin ninguna forma de distinguirlas.
      consulta
        .order("last_activity_at", { ascending: false })
        .limit(100),
      "inbox:conversations"
    ),
    getTeamRoster(),
  ]);
  // Pendientes primero (plan 6): los chats que esperan a un asesor arriba,
  // el mas viejo primero; despues el resto por actividad, como siempre.
  conversations.sort((a, b) => {
    const pa = a.leads?.atencion_pendiente ? 1 : 0;
    const pb = b.leads?.atencion_pendiente ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (pa && pb) return String(a.leads?.atencion_desde).localeCompare(String(b.leads?.atencion_desde));
    return 0;
  });
  const pendientes = conversations.filter((c) => c.leads?.atencion_pendiente).length;
  const nuevos = conversations.filter((c) => c.leads?.estado === "nuevo").length;
  const calificados = conversations.filter((c) => c.leads?.estado === "calificado").length;
  const humano = conversations.filter((c) => c.modo === "humano").length;

  const stats = [
    { label: "Esperan a un asesor", value: pendientes, color: "text-amber-600" },
    { label: "Conversaciones activas", value: conversations.length, color: "text-slate-900" },
    { label: "Nuevos", value: nuevos, color: "text-slate-600" },
    { label: "Calificados", value: calificados, color: "text-amber-600" },
    { label: "Asesor al mando", value: humano, color: "text-purple-600" },
  ];

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-5 text-2xl font-bold text-slate-900">Inbox</h1>
      {hasError && <ErrorBanner message={message} />}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
      <InboxList conversations={conversations} admin={admin} roster={roster} currentUserId={user?.id || ""} />
    </div>
  );
}
