import { Kpi } from "@/components/dashboard-matches";
import type { SalidaPedido } from "@/lib/amoblados";

// Isla oscura del panel de amoblados (mockup aprobado 2026-09-12): mismo
// navy/dorado que el dashboard de /grupos. Solo presentación.
export default function AmobladosDashboard({
  dias,
  arriendo,
  conMatch,
  salidas,
}: {
  dias: number;
  /** null = el conteo falló: se muestra "—", nunca un cero. */
  arriendo: number | null;
  conMatch: number;
  salidas: Record<SalidaPedido, number>;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1526] via-[#13223a] to-[#1b2b47] p-5 text-white sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(600px 220px at 85% -10%, rgba(201,162,75,.18), transparent 70%)" }}
      />
      <div className="relative">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Arriendo · últimos {dias} días</h2>
          <span className="text-xs text-slate-400">sale de la base, no se reinicia con los despliegues</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-2.5">
          <Kpi n={arriendo ?? "—"} titulo="Pedidos de arriendo" detalle="detectados en los grupos" tono="sky" />
          <Kpi n={conMatch} titulo="Con match" detalle="calzan con un amoblado" tono="indigo" href="#pedidos" />
          <Kpi n={salidas.aviso} titulo="Aviso a la asesora" detalle="para que ella le escriba" tono="amber" />
          <Kpi n={salidas.dm} titulo="DM al colega" detalle="salió solo, sin asesora" tono="teal" />
          <Kpi n={salidas.descartado} titulo="Descartó Sofi" detalle="revisó y no le servía" tono="slate" />
        </div>
        {salidas.sin_dueno > 0 && (
          <p className="mt-3 rounded-md bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
            <b>{salidas.sin_dueno} sin dueño:</b> pedidos con match sin aviso, sin DM y sin descarte de Sofi. Un
            match nunca debería quedar sin salida: revisalos abajo.
          </p>
        )}
      </div>
    </section>
  );
}
