import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId } from "@/lib/marketing";

export const dynamic = "force-dynamic";

interface TemplateRow {
  id: string;
  name: string;
  kind: "copy" | "creative_layout";
  created_at: string;
}

export default async function PlantillasPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;

  const { data } = await supabase
    .from("content_templates")
    .select("id,name,kind,created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  const templates = (data || []) as TemplateRow[];

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Guardá un copy o layout desde el Content Studio para reutilizarlo en próximas publicaciones.
      </p>
      {templates.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          Todavía no hay plantillas guardadas.
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <span className="font-medium text-slate-900">{t.name}</span>
              <span className="text-xs text-slate-500">{t.kind === "copy" ? "Copy" : "Layout"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
