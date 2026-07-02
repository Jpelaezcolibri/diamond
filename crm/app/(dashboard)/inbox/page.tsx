import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ESTADO_COLORS, type Conversation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("*, leads(*)")
    .eq("estado", "activa")
    .order("last_activity_at", { ascending: false })
    .limit(100);

  const conversations = (data || []) as Conversation[];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-bold">Inbox</h1>
      {conversations.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Sin conversaciones todavía. Cuando un cliente le escriba a Sofi, aparecerá aquí.
        </p>
      )}
      <ul className="space-y-2">
        {conversations.map((c) => (
          <li key={c.id}>
            <Link
              href={`/inbox/${c.id}`}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
            >
              <div>
                <p className="font-medium">
                  {c.leads?.nombre || `+${c.leads?.phone}`}
                  {c.modo === "humano" && (
                    <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                      asesor al mando
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-500">
                  {c.leads?.property_ref_origen ? `Propiedad ${c.leads.property_ref_origen} · ` : ""}
                  {c.leads?.forma_pago || c.leads?.tipo_interes || "sin datos aún"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs ${ESTADO_COLORS[c.leads?.estado] || "bg-slate-100"}`}>
                  {c.leads?.estado}
                </span>
                <span className="text-sm font-semibold text-slate-700">{c.leads?.score ?? 0}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
