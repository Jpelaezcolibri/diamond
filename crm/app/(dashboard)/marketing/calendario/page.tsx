import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId, PUBLICATION_STATUS_COLORS, PUBLICATION_STATUS_LABELS, type PublicationRow } from "@/lib/marketing";

export const dynamic = "force-dynamic";

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default async function CalendarioPage() {
  const supabase = await createClient();
  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return <p className="text-slate-500">No hay ninguna organización configurada todavía.</p>;

  const { data } = await supabase
    .from("publications")
    .select("*, properties(ref,titulo)")
    .eq("org_id", orgId)
    .in("status", ["scheduled", "publishing", "published", "partially_published", "failed"])
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true })
    .limit(200);

  const publications = (data || []) as (PublicationRow & { properties: { ref: string; titulo: string } | null })[];
  const groups = new Map<string, typeof publications>();
  for (const p of publications) {
    const key = dayKey(p.scheduled_at!);
    groups.set(key, [...(groups.get(key) || []), p]);
  }

  return (
    <div className="space-y-6">
      {groups.size === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No hay publicaciones programadas todavía.
        </p>
      ) : (
        [...groups.entries()].map(([day, items]) => (
          <div key={day}>
            <h3 className="mb-2 text-sm font-semibold capitalize text-slate-700">{day}</h3>
            <ul className="space-y-2">
              {items.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/marketing/publicaciones/${p.id}`}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c9a24b]/50 hover:shadow-md"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{p.titulo_comercial || p.properties?.titulo}</p>
                      <p className="text-xs text-slate-500">{p.properties?.ref}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">
                        {new Date(p.scheduled_at!).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PUBLICATION_STATUS_COLORS[p.status]}`}>
                        {PUBLICATION_STATUS_LABELS[p.status]}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
