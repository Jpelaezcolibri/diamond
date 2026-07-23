import { createClient } from "@/lib/supabase/server";
import { getTeamRoster } from "@/lib/team";
import { type AllyProperty } from "@/lib/types";
import AliadosTable from "@/components/aliados-table";

export const dynamic = "force-dynamic";

export default async function AliadosPage() {
  const supabase = await createClient();

  const [{ data }, roster] = await Promise.all([
    supabase
      .from("ally_properties")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    getTeamRoster(),
  ]);

  const aliados = (data || []) as AllyProperty[];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Red de aliados</h1>
      <p className="mb-4 text-sm text-slate-500">
        Propiedades de otras inmobiliarias que colegas comparten con nosotros — nunca son inventario propio. Confirma
        disponibilidad antes de ofrecerlas a un cliente.
      </p>
      <AliadosTable items={aliados} roster={roster} />
    </div>
  );
}
