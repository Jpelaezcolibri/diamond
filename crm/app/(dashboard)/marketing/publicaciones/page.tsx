import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId, PUBLICATION_STATUS_COLORS, PUBLICATION_STATUS_LABELS, STYLE_VARIANT_LABELS, type PublicationRow } from "@/lib/marketing";

export const dynamic = "force-dynamic";

export default async function PublicacionesPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;

  const { data } = await supabase
    .from("publications")
    .select("*, properties(ref,titulo,zona)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);

  const publications = (data || []) as (PublicationRow & { properties: { ref: string; titulo: string; zona: string | null } | null })[];

  return (
    <div>
      {publications.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          Todavía no se ha generado ninguna publicación. Andá al Dashboard y generá una desde una novedad del inventario.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Propiedad</th>
                <th className="px-4 py-3">Estilo</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Programada</th>
                <th className="px-4 py-3">Creada</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/marketing/publicaciones/${p.id}`} className="font-medium text-slate-900 hover:text-[#c9a24b]">
                      {p.titulo_comercial || p.properties?.titulo || "Sin título"}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {p.properties?.ref} {p.properties?.zona ? `· ${p.properties.zona}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.style_variant ? STYLE_VARIANT_LABELS[p.style_variant] : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PUBLICATION_STATUS_COLORS[p.status]}`}>
                      {PUBLICATION_STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.scheduled_at ? new Date(p.scheduled_at).toLocaleString("es-CO") : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(p.created_at).toLocaleDateString("es-CO")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
