import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId, PUBLICATION_STATUS_LABELS, type PublicationRow, type PropertyChangeEventRow, type SyncRunRow } from "@/lib/marketing";
import NovedadesSection from "@/components/marketing/novedades-section";
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

  const novedadSelect = "*, properties(ref,titulo,zona,ciudad,operacion,precio,images)";
  const [
    { data: pendientes },
    { count: pendientesTotal },
    { data: retiradas },
    { count: retiradasTotal },
    { data: drafts },
    { data: proximas },
    { data: lastSync },
  ] = await Promise.all([
    supabase
      .from("property_change_events")
      .select(novedadSelect)
      .eq("org_id", orgId)
      .eq("processed", false)
      .neq("change_type", "removed")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("property_change_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("processed", false)
      .neq("change_type", "removed"),
    supabase
      .from("property_change_events")
      .select(novedadSelect)
      .eq("org_id", orgId)
      .eq("processed", false)
      .eq("change_type", "removed")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("property_change_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("processed", false)
      .eq("change_type", "removed"),
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

  type NovedadWithProperty = PropertyChangeEventRow & {
    properties: { ref: string; titulo: string; zona: string | null; ciudad: string | null; operacion: string | null; precio: string | null; images: string[] } | null;
  };
  const pendientesRows = (pendientes || []) as NovedadWithProperty[];
  const retiradasRows = (retiradas || []) as NovedadWithProperty[];
  const draftRows = (drafts || []) as (PublicationRow & { properties: { ref: string; titulo: string } | null })[];
  const proximasRows = (proximas || []) as (PublicationRow & { properties: { ref: string; titulo: string } | null })[];
  const syncRun = lastSync as SyncRunRow | null;

  // Propiedades con novedad "pendiente" que ya tienen una publicacion activa
  // (cualquier estado menos "archived"): evita el boton "Generar publicacion"
  // para no duplicar contenido de una propiedad que ya se esta promocionando.
  const pendientePropertyIds = [...new Set(pendientesRows.map((n) => n.property_id).filter((id): id is string => Boolean(id)))];
  const { data: activePublications } =
    pendientePropertyIds.length > 0
      ? await supabase
          .from("publications")
          .select("id,property_id,status")
          .eq("org_id", orgId)
          .in("property_id", pendientePropertyIds)
          .neq("status", "archived")
      : { data: [] as { id: string; property_id: string; status: string }[] };
  const publicationByPropertyId = new Map((activePublications || []).map((p) => [p.property_id, { id: p.id, status: p.status }]));

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

      <NovedadesSection
        orgId={orgId}
        pendientes={pendientesRows.map((n) => ({
          id: n.id,
          propertyId: n.property_id,
          changeLabel: CHANGE_TYPE_LABELS[n.change_type] || n.change_type,
          propertyRef: n.properties?.ref || "—",
          titulo: n.properties?.titulo || "Propiedad sin título",
          zona: n.properties?.zona ?? null,
          precio: n.properties?.precio ?? null,
          createdAt: n.created_at,
          existingPublication: n.property_id ? publicationByPropertyId.get(n.property_id) ?? null : null,
        }))}
        pendientesTotal={pendientesTotal ?? 0}
        retiradas={retiradasRows.map((n) => ({
          id: n.id,
          propertyId: n.property_id,
          changeLabel: CHANGE_TYPE_LABELS[n.change_type] || n.change_type,
          propertyRef: n.properties?.ref || "—",
          titulo: n.properties?.titulo || "Propiedad sin título",
          zona: n.properties?.zona ?? null,
          precio: n.properties?.precio ?? null,
          createdAt: n.created_at,
        }))}
        retiradasTotal={retiradasTotal ?? 0}
      />

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
