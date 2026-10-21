import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";
import { isAdmin } from "@/lib/auth";
import { Kpi } from "@/components/dashboard-matches";
import MapaDemandaVista from "@/components/demanda/mapa-demanda";
import {
  META_CAPTACIONES_MES,
  PERIODOS_DEMANDA,
  fmtEntero,
  type MapaDemanda,
  type Operacion,
} from "@/lib/demanda";

export const dynamic = "force-dynamic";

// Mapa de demanda para captar (mockup aprobado por Juan el 2026-10-21,
// docs/superpowers/mockups/2026-10-21-mapa-demanda.html). El calculo lo hace
// el bot (GET/POST /api/demanda, src/groups/mapa-demanda.js) con cache de 10
// minutos; si el bot no responde, la pagina muestra un estado vacio amable.

export default async function DemandaPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; op?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { dias: diasParam, op } = await searchParams;
  const dias = PERIODOS_DEMANDA.some((d) => String(d) === diasParam) ? Number(diasParam) : 30;
  const operacion: Operacion = op === "arriendo" ? "arriendo" : "venta";

  const r = await callBot<MapaDemanda>(
    "/api/demanda",
    { dias, operacion, authUserId: user.id, esAdmin: isAdmin(user) },
    { timeoutMs: 30_000 }
  );
  const mapa = r.ok && r.data?.ok ? r.data : null;
  const error = r.ok ? (mapa ? null : "El bot no devolvió el mapa") : r.error;

  const k = mapa?.kpis;
  const meta = META_CAPTACIONES_MES;
  const captadas = k?.captacionesCalientes ?? 0;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-3 py-4 sm:px-4 sm:py-5">
      <section className="relative overflow-hidden rounded-3xl bg-[#0b1526] p-4 text-white sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-xl font-bold">
            Mapa de demanda <span className="text-[#c9a24b]">· últimos {dias} días</span>
          </h1>
          <nav className="inline-flex rounded-lg bg-white/10 p-0.5" aria-label="Período">
            {PERIODOS_DEMANDA.map((d) => (
              <Link
                key={d}
                href={`/demanda?dias=${d}&op=${operacion}`}
                className={`rounded-md px-3 py-1.5 text-xs sm:text-sm ${
                  d === dias ? "bg-white font-semibold text-[#0b1526]" : "text-slate-300 hover:text-white"
                }`}
              >
                {d} días
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
          <Kpi
            n={k ? fmtEntero(k.pedidos) : "—"}
            titulo="Pedidos de colegas"
            detalle={k ? `de ${operacion === "venta" ? "compra" : "arriendo"}, en ${k.grupos} ${k.grupos === 1 ? "grupo" : "grupos"}` : "sin datos"}
            tono="sky"
          />
          <Kpi
            n={k ? fmtEntero(k.sinInventario) : "—"}
            titulo="Pedidos sin inventario nuestro"
            detalle={k ? `${k.pctSinInventario} % de los pedidos` : "sin datos"}
            tono="indigo"
          />
          <Kpi n={k ? k.celdasCalientes : "—"} titulo="Celdas calientes" detalle="zona · tipo · precio donde captar" tono="rose" />
          <div className="flex min-h-24 min-w-0 flex-col justify-between rounded-xl bg-teal-600 p-2.5 text-white sm:p-3">
            <p className="font-display text-2xl font-extrabold leading-none tabular-nums sm:text-3xl">
              {k ? `${captadas} de ${meta}` : "—"}
            </p>
            <div className="min-w-0">
              <p className="mt-2 text-[11px] font-bold leading-tight sm:text-xs">Captaciones en celdas calientes</p>
              <p className="text-[10px] leading-tight opacity-80 sm:text-[11px]">este mes · meta del mes</p>
              <div className="mt-2 h-[7px] overflow-hidden rounded bg-white/30">
                <span className="block h-full rounded bg-white" style={{ width: `${Math.min(100, Math.round((captadas / meta) * 100))}%` }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {mapa ? (
        <MapaDemandaVista key={`${dias}-${operacion}`} mapa={mapa} dias={dias} operacion={operacion} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center">
          <p className="text-base font-semibold text-slate-800">No pudimos traer el mapa de demanda en este momento.</p>
          <p className="mt-1 text-sm text-slate-500">
            El bot no respondió{error ? ` (${error})` : ""}. Prueba de nuevo en un rato; los pedidos siguen guardados.
          </p>
          <Link
            href={`/demanda?dias=${dias}&op=${operacion}`}
            className="mt-4 inline-block rounded-lg border border-[#0b1526] px-3 py-1.5 text-sm font-semibold text-[#0b1526] hover:bg-[#0b1526] hover:text-white"
          >
            Reintentar
          </Link>
        </div>
      )}

      <p className="text-[12.5px] text-slate-500">
        Fuente: pedidos que publican los colegas en los grupos de WhatsApp, leídos por el radar. Un pedido repetido en varios
        grupos cuenta una vez.
      </p>
    </div>
  );
}
