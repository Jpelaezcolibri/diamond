import { createClient } from "@/lib/supabase/server";
import { ESTADO_COLORS, type Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .order("score", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  const leads = (data || []) as Lead[];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">Leads</h1>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Teléfono</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Propiedad</th>
              <th className="px-4 py-3">Forma de pago</th>
              <th className="px-4 py-3">Urgencia</th>
              <th className="px-4 py-3">Presupuesto</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{l.nombre || "—"}</td>
                <td className="px-4 py-3">+{l.phone}</td>
                <td className="px-4 py-3 font-semibold">{l.score}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${ESTADO_COLORS[l.estado] || "bg-slate-100"}`}>
                    {l.estado}
                  </span>
                </td>
                <td className="px-4 py-3">{l.property_ref_origen || "—"}</td>
                <td className="px-4 py-3">{l.forma_pago || "—"}</td>
                <td className="px-4 py-3">{l.urgencia || "—"}</td>
                <td className="px-4 py-3">{l.presupuesto || "—"}</td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  Sin leads todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
