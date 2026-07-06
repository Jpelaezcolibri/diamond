import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId } from "@/lib/marketing";
import PropiedadesTable, { type PropiedadRow } from "@/components/marketing/propiedades-table";

export const dynamic = "force-dynamic";

export default async function PublicacionesPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;

  const [{ data: properties }, { data: publications }, { data: newEvents }] = await Promise.all([
    supabase
      .from("properties")
      .select("id,ref,titulo,zona,ciudad,precio")
      .eq("org_id", orgId)
      .eq("disponible", true)
      .order("titulo"),
    supabase
      .from("publications")
      .select("id,property_id,status,style_variant,scheduled_at,created_at")
      .eq("org_id", orgId)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
    supabase
      .from("property_change_events")
      .select("property_id")
      .eq("org_id", orgId)
      .eq("change_type", "created")
      .eq("processed", false),
  ]);

  // Una propiedad puede tener mas de una publicacion no archivada en teoria;
  // se toma la mas reciente (publications ya viene ordenado desc).
  const publicationByPropertyId = new Map<string, { id: string; status: string; styleVariant: string | null; scheduledAt: string | null }>();
  for (const p of publications || []) {
    if (!p.property_id || publicationByPropertyId.has(p.property_id)) continue;
    publicationByPropertyId.set(p.property_id, { id: p.id, status: p.status, styleVariant: p.style_variant, scheduledAt: p.scheduled_at });
  }
  const newPropertyIds = new Set((newEvents || []).map((e) => e.property_id).filter(Boolean));

  const rows: PropiedadRow[] = (properties || []).map((p) => ({
    id: p.id,
    ref: p.ref,
    titulo: p.titulo,
    zona: p.zona,
    ciudad: p.ciudad,
    precio: p.precio,
    isNew: newPropertyIds.has(p.id),
    publication: publicationByPropertyId.get(p.id) ?? null,
  }));

  // Nuevas primero, luego sin publicar, luego el resto — para que lo
  // accionable quede arriba en vez de perderse entre 96 filas.
  rows.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    if (Boolean(a.publication) !== Boolean(b.publication)) return a.publication ? 1 : -1;
    return a.titulo.localeCompare(b.titulo);
  });

  const totalPublicadas = rows.filter((r) => r.publication).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {rows.length} propiedades disponibles · {totalPublicadas} con publicación activa · {rows.length - totalPublicadas} sin publicar
      </p>
      <PropiedadesTable orgId={orgId} rows={rows} />
    </div>
  );
}
