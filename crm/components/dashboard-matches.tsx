import GruposLiveWatcher from "@/components/grupos-live-watcher";

// La "isla" oscura de /grupos (rediseño aprobado por Juan, 2026-09-02): el
// único bloque con fondo navy + dorado de la marca, para tener el look de
// dashboard sin oscurecer el resto del CRM. Recibe los números ya
// calculados en page.tsx -- acá no hay ninguna consulta, solo presentación.
//
// Los KPIs van agrupados por carril, no en una fila suelta: el color y la
// posición dicen de qué lado del negocio es cada número.

export type MetricasRadar = {
  dias: number;
  demandas: number;
  ofertas: number;
  demandasConMatch: number;
  demandasPorDia: number;
  ofertasPorDia: number;
  tasaMatch: number;
};

type Props = {
  admin: boolean;
  mandatosActivos: number;
  pedidosConMatch: number;
  pedidosPorRevisar: number;
  propiedadesConMatch: number;
  /** null = la consulta falló (page.tsx muestra el ErrorBanner aparte). */
  autoDm: number | null;
  /** DMs que una persona mando desde el CRM (politica_motivo = 'dm_manual'). */
  dmManual: number | null;
  reenvioManual: number | null;
  /** Solo admin. */
  sinEntregar: number;
  /** Solo admin, viene del bot; null si el bot no respondió. */
  metricas: MetricasRadar | null;
};

// Clases completas, nunca interpoladas: Tailwind 4 solo genera las que ve
// escritas tal cual.
const TONO = {
  indigo: "bg-indigo-600",
  teal: "bg-teal-600",
  amber: "bg-amber-500",
  sky: "bg-sky-600",
  green: "bg-emerald-600",
  rose: "bg-rose-600",
} as const;

function Kpi({
  n,
  titulo,
  detalle,
  tono,
  badge,
  badgeTono = "text-indigo-700",
}: {
  n: number | string;
  titulo: string;
  detalle: string;
  tono: keyof typeof TONO;
  badge?: string | null;
  badgeTono?: "text-indigo-700" | "text-rose-700" | "text-teal-700";
}) {
  // El badge va debajo del detalle, no flotando arriba a la derecha: con
  // "171 por revisar" y un 172 al lado se pisaban (visto con datos reales).
  return (
    <div className={`flex min-h-24 min-w-0 flex-col justify-between rounded-xl p-2.5 text-white sm:p-3 ${TONO[tono]}`}>
      <p className="font-display text-2xl font-extrabold leading-none tabular-nums sm:text-3xl">{n}</p>
      <div className="min-w-0">
        <p className="mt-2 text-[11px] font-bold leading-tight sm:text-xs">{titulo}</p>
        <p className="text-[10px] leading-tight opacity-80 sm:text-[11px]">{detalle}</p>
        {badge && (
          <span className={`mt-1.5 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${badgeTono}`}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

function Carril({ tono, etiqueta, descripcion, children }: {
  tono: "indigo" | "green";
  etiqueta: string;
  descripcion: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <span className={`rounded-md px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white ${TONO[tono]}`}>
          {etiqueta}
        </span>
        <span className="text-xs text-slate-400">{descripcion}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5">{children}</div>
    </div>
  );
}

export default function DashboardMatches({
  admin,
  mandatosActivos,
  pedidosConMatch,
  pedidosPorRevisar,
  propiedadesConMatch,
  autoDm,
  dmManual,
  reenvioManual,
  sinEntregar,
  metricas,
}: Props) {
  const atendidos = (autoDm ?? 0) + (reenvioManual ?? 0);
  const pctAuto = atendidos > 0 ? Math.round(((autoDm ?? 0) / atendidos) * 100) : null;

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1526] via-[#13223a] to-[#1b2b47] p-5 text-white sm:p-6">
      {/* Brillo dorado arriba a la derecha: mismo dorado del header del CRM. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(600px 220px at 85% -10%, rgba(201,162,75,.18), transparent 70%)" }}
      />
      <div className="relative">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold">Dashboard de matches</h2>
            <p className="text-xs text-slate-400">
              Dos carriles: lo que entra (pedidos de colegas contra tu inventario) y lo que sale (ofertas de
              colegas contra tus mandatos de compra).
            </p>
          </div>
          <GruposLiveWatcher tono="dorado" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Carril tono="indigo" etiqueta="→ Entrada" descripcion="Pedidos de colegas · respondemos nosotros">
            <Kpi
              n={pedidosConMatch}
              titulo="Pedidos con match"
              detalle="calzan con inventario propio"
              tono="indigo"
              badge={pedidosPorRevisar > 0 ? `${pedidosPorRevisar} por revisar` : null}
            />
            <Kpi
              n={autoDm ?? "—"}
              titulo="Bot resolvió solo"
              detalle="DM directo al colega, sin asesora"
              tono="teal"
              badge={dmManual ? `${dmManual} manual${dmManual === 1 ? "" : "es"} desde el CRM` : null}
              badgeTono="text-teal-700"
            />
            <Kpi n={reenvioManual ?? "—"} titulo="Asesora reenvió a mano" detalle="sin teléfono resuelto" tono="amber" />
          </Carril>
          <Carril tono="green" etiqueta="← Salida" descripcion="Ofertas de colegas · se las mostramos al cliente">
            <Kpi n={mandatosActivos} titulo="Mandatos activos" detalle="clientes propios buscando" tono="sky" />
            <Kpi n={propiedadesConMatch} titulo="Propiedades con match" detalle="ofertas que sirven a un mandato" tono="green" />
            {admin ? (
              <Kpi
                n={sinEntregar}
                titulo="Sin entregar"
                detalle="avisos que no llegaron a la asesora"
                tono="rose"
                badge={sinEntregar > 0 ? "atender" : null}
                badgeTono="text-rose-700"
              />
            ) : (
              // Un asesor no ve "sin entregar" (es supervisión del carril
              // completo). La celda vacía mantiene la grilla alineada.
              <div className="rounded-xl border border-dashed border-white/10" />
            )}
          </Carril>
        </div>

        <div className={`mt-4 grid gap-4 ${metricas ? "lg:grid-cols-[1.3fr_1fr]" : ""}`}>
          <div className="rounded-2xl bg-white/5 p-3.5">
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-300">
              <span>Cuánto resuelve el bot solo</span>
              <b className="tabular-nums text-white">
                {pctAuto === null ? "todavía sin pedidos atendidos" : `${autoDm} de ${atendidos} · ${pctAuto} %`}
              </b>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-white/10">
              {pctAuto !== null && (
                <>
                  <i className="block h-full bg-teal-500" style={{ width: `${pctAuto}%` }} />
                  <i className="block h-full bg-amber-500" style={{ width: `${100 - pctAuto}%` }} />
                </>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-400">
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-teal-500 align-middle" />DM automático</span>
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-amber-500 align-middle" />Reenvío a mano de la asesora</span>
            </div>
          </div>

          {metricas && (
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white/5 p-3.5 sm:grid-cols-5">
              {[
                { n: metricas.demandas, t: "pedidos", d: "colegas buscando algo" },
                { n: metricas.demandasConMatch, t: "con match", d: "los únicos accionables" },
                { n: metricas.ofertas, t: "propiedades", d: "publicadas por colegas" },
                { n: metricas.demandasPorDia.toFixed(1), t: "pedidos/día", d: "caudal del canal" },
                { n: `${Math.round(metricas.tasaMatch * 100)} %`, t: "tasa match", d: "de los pedidos, cuántos podemos responder" },
              ].map((c) => (
                <div key={c.t} title={c.d}>
                  <p className="font-display text-lg font-bold tabular-nums">{c.n}</p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">{c.t}</p>
                </div>
              ))}
              <p className="col-span-full text-[11px] text-slate-500">
                Últimos {metricas.dias} días · sale de la base, no se reinicia con los deploys
              </p>
              {metricas.demandas > 10 && metricas.tasaMatch < 0.1 && (
                <p className="col-span-full rounded-md bg-amber-500/15 px-3 py-2 text-[11px] text-amber-200">
                  Se detectan pedidos pero casi ninguno calza con el inventario. O estos grupos piden otra cosa
                  de la que tenemos, o al inventario le faltan zonas cargadas.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
