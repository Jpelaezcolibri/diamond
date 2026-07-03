import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth";
import { type Conversation } from "@/lib/types";
import InboxList from "@/components/inbox-list";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isSuperAdmin(user);

  const { data } = await supabase
    .from("conversations")
    .select("*, leads(*)")
    .eq("estado", "activa")
    .order("last_activity_at", { ascending: false })
    .limit(100);

  const conversations = (data || []) as Conversation[];
  const nuevos = conversations.filter((c) => c.leads?.estado === "nuevo").length;
  const calificados = conversations.filter((c) => c.leads?.estado === "calificado").length;
  const humano = conversations.filter((c) => c.modo === "humano").length;

  const stats = [
    { label: "Conversaciones activas", value: conversations.length, color: "text-slate-900" },
    { label: "Nuevos", value: nuevos, color: "text-slate-600" },
    { label: "Calificados", value: calificados, color: "text-amber-600" },
    { label: "Asesor al mando", value: humano, color: "text-purple-600" },
  ];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-5 text-2xl font-bold text-slate-900">Inbox</h1>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
      <InboxList conversations={conversations} admin={admin} />
    </div>
  );
}
