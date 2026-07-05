import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId } from "@/lib/marketing";

export const dynamic = "force-dynamic";

interface MetricRow {
  publication_target_id: string;
  collected_at: string;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  saved: number | null;
}

interface TargetWithContext {
  id: string;
  platform: "facebook" | "instagram";
  permalink: string | null;
  publications: { titulo_comercial: string | null; properties: { ref: string } | null } | null;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;

  const { data: targets } = await supabase
    .from("publication_targets")
    .select("id,platform,permalink,publications!inner(org_id, titulo_comercial, properties(ref))")
    .eq("status", "published")
    .eq("publications.org_id", orgId);

  const targetRows = (targets || []) as unknown as TargetWithContext[];
  const targetIds = targetRows.map((t) => t.id);

  let metricsByTarget = new Map<string, MetricRow>();
  if (targetIds.length > 0) {
    const { data: metrics } = await supabase
      .from("post_metrics")
      .select("*")
      .in("publication_target_id", targetIds)
      .order("collected_at", { ascending: false });
    const rows = (metrics || []) as MetricRow[];
    // La primera fila por target (ya viene ordenado desc) es el snapshot mas reciente.
    for (const row of rows) {
      if (!metricsByTarget.has(row.publication_target_id)) metricsByTarget.set(row.publication_target_id, row);
    }
  }

  const totals = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  for (const m of metricsByTarget.values()) {
    totals.impressions += m.impressions ?? 0;
    totals.reach += m.reach ?? 0;
    totals.likes += m.likes ?? 0;
    totals.comments += m.comments ?? 0;
    totals.shares += m.shares ?? 0;
    totals.clicks += m.clicks ?? 0;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {Object.entries(totals).map(([key, value]) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-xs capitalize text-slate-500">{key}</p>
          </div>
        ))}
      </div>

      {targetRows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          Todavía no hay publicaciones publicadas para medir. Las métricas se recolectan automáticamente cada 6 horas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Publicación</th>
                <th className="px-4 py-3">Red</th>
                <th className="px-4 py-3">Alcance</th>
                <th className="px-4 py-3">Likes</th>
                <th className="px-4 py-3">Comentarios</th>
                <th className="px-4 py-3">Compartidos</th>
                <th className="px-4 py-3">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {targetRows.map((t) => {
                const m = metricsByTarget.get(t.id);
                return (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      {t.permalink ? (
                        <a href={t.permalink} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:text-[#c9a24b]">
                          {t.publications?.titulo_comercial || t.publications?.properties?.ref || t.id.slice(0, 8)}
                        </a>
                      ) : (
                        <span className="font-medium text-slate-900">{t.publications?.titulo_comercial || t.id.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{t.platform === "facebook" ? "📘 Facebook" : "📸 Instagram"}</td>
                    <td className="px-4 py-3">{m?.reach ?? "—"}</td>
                    <td className="px-4 py-3">{m?.likes ?? "—"}</td>
                    <td className="px-4 py-3">{m?.comments ?? "—"}</td>
                    <td className="px-4 py-3">{m?.shares ?? "—"}</td>
                    <td className="px-4 py-3">{m?.clicks ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
