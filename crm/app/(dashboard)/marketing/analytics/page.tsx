import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId, PUBLICATION_STATUS_LABELS, type PublicationStatus } from "@/lib/marketing";

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

interface RemovedEventRow {
  id: number;
  property_id: string | null;
  created_at: string;
  properties: { ref: string; titulo: string; zona: string | null; ciudad: string | null; precio: string | null; operacion: string | null } | null;
}

interface RelatedPublicationRow {
  id: string;
  property_id: string | null;
  status: PublicationStatus;
}

/**
 * Meta/Facebook Insights no tiene ningun concepto de "propiedad vendida" —
 * eso solo lo sabe Wasi. Esta seccion cruza los retiros que ya detecta el
 * sync (property_change_events change_type='removed') con las
 * publicaciones activas de esa propiedad, para avisar si sigue habiendo
 * publicidad corriendo sobre algo que ya no esta disponible.
 */
function activePromoBadge(statuses: PublicationStatus[]): { label: string; color: string } {
  if (statuses.length === 0) return { label: "Sin publicidad asociada", color: "bg-slate-100 text-slate-500" };
  if (statuses.some((s) => s === "published" || s === "partially_published")) {
    return { label: "Publicado — revisar", color: "bg-red-100 text-red-700" };
  }
  if (statuses.some((s) => s === "scheduled" || s === "publishing")) {
    return { label: "Programado — revisar", color: "bg-amber-100 text-amber-700" };
  }
  if (statuses.some((s) => s === "approved" || s === "draft")) {
    return { label: "Pendiente de aprobar", color: "bg-blue-100 text-blue-700" };
  }
  return { label: "Sin publicidad activa", color: "bg-slate-100 text-slate-500" };
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

  // Propiedades vendidas/retiradas de Wasi (change_type='removed', detectado por el sync)
  // cruzadas con sus publicaciones activas, para avisar si hay que bajar un anuncio.
  const { data: removedEventsData } = await supabase
    .from("property_change_events")
    .select("id, property_id, created_at, properties(ref,titulo,zona,ciudad,precio,operacion)")
    .eq("org_id", orgId)
    .eq("change_type", "removed")
    .order("created_at", { ascending: false })
    .limit(50);

  const removedEvents = (removedEventsData || []) as unknown as RemovedEventRow[];
  const removedPropertyIds = removedEvents.map((e) => e.property_id).filter((id): id is string => Boolean(id));

  const publicationsByProperty = new Map<string, RelatedPublicationRow[]>();
  if (removedPropertyIds.length > 0) {
    const { data: relatedPublications } = await supabase
      .from("publications")
      .select("id, property_id, status")
      .in("property_id", removedPropertyIds)
      .neq("status", "archived");
    for (const p of (relatedPublications || []) as RelatedPublicationRow[]) {
      if (!p.property_id) continue;
      publicationsByProperty.set(p.property_id, [...(publicationsByProperty.get(p.property_id) || []), p]);
    }
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

      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Propiedades vendidas / retiradas de Wasi</h2>
        <p className="mb-3 text-sm text-slate-500">
          Meta no sabe si una propiedad se vendió — esto viene del sync con Wasi. Si una propiedad retirada sigue con
          publicidad activa, bájala desde su Content Studio.
        </p>
        {removedEvents.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Ninguna propiedad se ha retirado de Wasi todavía (o el sync no se ha ejecutado).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Propiedad</th>
                  <th className="px-4 py-3">Retirada</th>
                  <th className="px-4 py-3">Publicidad</th>
                </tr>
              </thead>
              <tbody>
                {removedEvents.map((e) => {
                  const related = e.property_id ? publicationsByProperty.get(e.property_id) || [] : [];
                  const badge = activePromoBadge(related.map((r) => r.status));
                  const firstActive = related[0];
                  return (
                    <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{e.properties?.titulo || "Propiedad sin título"}</p>
                        <p className="text-xs text-slate-500">
                          {e.properties?.ref} {e.properties?.zona ? `· ${e.properties.zona}` : ""}{" "}
                          {e.properties?.precio ? `· ${e.properties.precio}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{new Date(e.created_at).toLocaleDateString("es-CO")}</td>
                      <td className="px-4 py-3">
                        {firstActive ? (
                          <Link href={`/marketing/publicaciones/${firstActive.id}`} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.color} hover:underline`}>
                            {badge.label} ({PUBLICATION_STATUS_LABELS[firstActive.status]})
                          </Link>
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.color}`}>{badge.label}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
