import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId, PUBLICATION_STATUS_LABELS, type PublicationRow, type PropertyChangeEventRow, type SyncRunRow } from "@/lib/marketing";
import NovedadCard from "@/components/marketing/novedad-card";
import SyncButton from "@/components/marketing/sync-button";
import Link from "next/link";

export const dynamic = "force-dynamic";

const CHANGE_TYPE_LABELS: Record<string, string> = {
  created: "Propiedad nueva",
  price_changed: "Cambio de precio",
  status_changed: "Cambio de disponibilidad",
  photos_changed: "Fotos actualizadas",
  description_changed: "Descripción actualizada",
  removed: "Retirada del catálogo",
};

export default async function MarketingDashboardPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);

  if (!orgId) {
    return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;
  }

  const [{ data: novedades }, { data: drafts }, { data: proximas }, { data: lastSync }] = await Promise.all([
    supabase
      .from("property_change_events")
      .select("*, properties(ref,titulo,zona,ciudad,operacion,precio,images)")
      .eq("org_id", orgId)
      .eq("processed", false)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("publications")
      .select("*, properties(ref,titulo)")
      .eq("org_id", orgId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("publications")
      .select("*, properties(ref,titulo)")
      .eq("org_id", orgId)
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true })
      .limit(10),
    supabase.from("sync_runs").select("*").eq("org_id", orgId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const novedadesRows = (novedades || []) as (PropertyChangeEventRow & {
    properties: { ref: string; titulo: string; zona: string | null; ciudad: string | null; operacion: string | null; precio: string | null; images: string[] } | null;
  })[];
  const draftRows = (drafts || []) as (PublicationRow & { properties: { ref: string; titulo: string } | null })[];
  const proximasRows = (proximas || []) as (PublicationRow & { properties: { ref: string; titulo: string } | null })[];
  const syncRun = lastSync as SyncRunRow | null;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm text-slate-600">
          {syncRun ? (
            <>
              Última sincronización ({syncRun.source === "wasi_api" ? "API oficial de Wasi" : "páginas públicas de Wasi"}):{" "}
              <span className="font-medium text-slate-900">
                {syncRun.status === "success" ? "exitosa" : syncRun.status === "failed" ? "con errores" : "en curso"}
              </span>{" "}
              · {syncRun.stats?.seen ?? 0} vistas, {syncRun.stats?.updated ?? 0} actualizadas, {syncRun.stats?.created ?? 0} nuevas
            </>
          ) : (
            "Todavía no se ha ejecutado ninguna sincronización con Wasi."
          )}
        </div>
        <SyncButton orgId={orgId} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Novedades del inventario</h2>
        {novedadesRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Sin novedades pendientes. Cuando Wasi tenga una propiedad nueva o un cambio de precio, aparecerá aquí.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {novedadesRows.map((n) => (
              <NovedadCard
                key={n.id}
                orgId={orgId}
                propertyId={n.property_id}
                changeLabel={CHANGE_TYPE_LABELS[n.change_type] || n.change_type}
                propertyRef={n.properties?.ref || "—"}
                titulo={n.properties?.titulo || "Propiedad sin título"}
                zona={n.properties?.zona}
                precio={n.properties?.precio}
                createdAt={n.created_at}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Borradores pendientes de aprobación</h2>
        {draftRows.length === 0 ? (
          <p className="text-sm text-slate-500">No hay borradores generados todavía.</p>
        ) : (
          <ul className="space-y-2">
            {draftRows.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/marketing/publicaciones/${d.id}`}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c9a24b]/50 hover:shadow-md"
                >
                  <div>
                    <p className="font-medium text-slate-900">{d.titulo_comercial || d.properties?.titulo || "Sin título"}</p>
                    <p className="text-xs text-slate-500">
                      {d.properties?.ref} · estilo {d.style_variant}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                    {PUBLICATION_STATUS_LABELS[d.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Próximas publicaciones</h2>
        {proximasRows.length === 0 ? (
          <p className="text-sm text-slate-500">No hay publicaciones programadas.</p>
        ) : (
          <ul className="space-y-2">
            {proximasRows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/marketing/publicaciones/${p.id}`}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c9a24b]/50 hover:shadow-md"
                >
                  <div>
                    <p className="font-medium text-slate-900">{p.titulo_comercial || p.properties?.titulo}</p>
                    <p className="text-xs text-slate-500">{p.properties?.ref}</p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {p.scheduled_at ? new Date(p.scheduled_at).toLocaleString("es-CO") : "sin fecha"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
