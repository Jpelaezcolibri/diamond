import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";
import { fetchSafe } from "@/lib/fetch-safe";
import ErrorBanner from "@/components/error-banner";
import GruposPanel, { type Grupo } from "@/components/grupos-panel";
import VincularLinea, { type Sesion, type Asesor } from "@/components/vincular-linea";

export const dynamic = "force-dynamic";

type Signal = {
  id: string;
  clase: "demanda" | "oferta";
  autor_nombre: string | null;
  operacion: string | null;
  tipo: string | null;
  zona: string | null;
  precio_max: number | null;
  habitaciones: number | null;
  texto_original: string | null;
  matches: { fuente: string; ref: string | null }[] | null;
  created_at: string;
};

type Metricas = {
  recibidos: number; prefiltrados: number; clasificados: number; senales: number;
  duplicados: number; ruido: number; historicos: number; costoUsd: number;
  lotesFallidos: number; pendientes: number; aliadas: number; alertas: number;
};

const pesos = (n: number | null) =>
  n && n > 0 ? `$${n.toLocaleString("es-CO")}` : null;

function Ficha({ s }: { s: Signal }) {
  const extraido = [s.operacion, s.tipo, s.zona, s.habitaciones ? `${s.habitaciones} alc` : null, pesos(s.precio_max)]
    .filter(Boolean)
    .join(" · ");
  const matches = s.matches || [];

  return (
    <li className="border-b border-slate-100 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{s.autor_nombre || "Colega"}</span>
        <span>{new Date(s.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
      </div>
      <p className="mt-0.5 text-sm text-slate-800">{s.texto_original}</p>
      {extraido && <p className="mt-1 text-xs text-slate-500">{extraido}</p>}
      {s.clase === "demanda" && (
        <p className="mt-1 text-xs">
          {matches.length === 0 ? (
            <span className="text-slate-400">sin match en inventario</span>
          ) : (
            <span className="text-emerald-700">
              {matches.length} match{matches.length > 1 ? "es" : ""}:{" "}
              {matches.map((m) => m.ref || "s/ref").join(", ")}
            </span>
          )}
        </p>
      )}
    </li>
  );
}

export default async function GruposPage() {
  const supabase = await createClient();

  // Esconder el link del menú no es control de acceso: acá se ve qué líneas
  // están vinculadas y el contenido de los grupos gremiales. Mismo guard que
  // /usuarios.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) redirect("/inbox");

  const [gruposRes, senalesRes, sesionesRes, asesoresRes] = await Promise.all([
    fetchSafe<Grupo>(
      supabase.from("whatsapp_groups").select("*").order("nombre"),
      "grupos:whatsapp_groups"
    ),
    fetchSafe<Signal>(
      supabase.from("group_signals").select("*").order("created_at", { ascending: false }).limit(100),
      "grupos:group_signals"
    ),
    fetchSafe<Sesion>(
      supabase.from("whatsapp_sessions").select("*").order("created_at"),
      "grupos:whatsapp_sessions"
    ),
    fetchSafe<Asesor>(
      supabase.from("advisors").select("id, name, phone").eq("activo", true).order("name"),
      "grupos:advisors"
    ),
  ]);

  // Métricas del embudo: viven en memoria del bot, no en la base. Se piden
  // acá para no obligar a abrir una terminal cada vez que se quiere mirar el
  // volumen o el costo. Si el bot no responde, la página igual carga.
  const metricasRes = await callBot<Metricas>("/api/grupos/metricas", {});
  const m = metricasRes.ok ? metricasRes.data : null;

  const grupos = gruposRes.data || [];
  const senales = senalesRes.data || [];
  const demandas = senales.filter((s) => s.clase === "demanda");
  const ofertas = senales.filter((s) => s.clase === "oferta");
  const conMatch = demandas.filter((s) => (s.matches || []).length > 0).length;
  const escuchando = grupos.filter((g) => g.modo !== "ignorar").length;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Grupos de WhatsApp</h1>
      <p className="mb-6 text-sm text-slate-500">
        Sofi escucha los grupos gremiales a través de la línea vinculada de un asesor.{" "}
        <strong>Nunca escribe en ningún grupo</strong> — sólo detecta. Un grupo nuevo aparece acá
        apagado y no procesa nada hasta que lo prendas.
      </p>

      {gruposRes.hasError && <ErrorBanner message={gruposRes.message} />}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: escuchando, t: "grupos escuchados", d: `de ${grupos.length} descubiertos` },
          { n: demandas.length, t: "demandas", d: "colegas buscando" },
          { n: conMatch, t: "con match", d: "atendibles con inventario" },
          { n: ofertas.length, t: "ofertas", d: "propiedades de colegas" },
        ].map((c) => (
          <div key={c.t} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-2xl font-bold tabular-nums text-slate-900">{c.n}</p>
            <p className="text-xs font-medium text-slate-700">{c.t}</p>
            <p className="text-xs text-slate-400">{c.d}</p>
          </div>
        ))}
      </div>

      {m && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">El embudo, desde el último reinicio del bot</h2>
            <span className="text-xs text-slate-400">se reinicia con cada deploy</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {[
              { n: m.recibidos, t: "mensajes", d: "llegaron de grupos prendidos" },
              { n: m.prefiltrados, t: "descartados gratis", d: "sin señal inmobiliaria" },
              { n: m.clasificados, t: "vistos por la IA", d: "los que sobrevivieron" },
              { n: m.senales, t: "señales", d: "demanda u oferta" },
              { n: m.historicos, t: "históricos", d: "anteriores al pareo" },
              { n: m.duplicados, t: "duplicados", d: "evitados" },
              { n: m.pendientes, t: "en cola", d: "esperando lote" },
            ].map((c) => (
              <div key={c.t} title={c.d}>
                <span className="text-lg font-bold tabular-nums text-slate-900">{c.n}</span>{" "}
                <span className="text-slate-600">{c.t}</span>
              </div>
            ))}
            <div title="Medido sobre los tokens reales, no estimado">
              <span className="text-lg font-bold tabular-nums text-slate-900">
                US${(m.costoUsd || 0).toFixed(4)}
              </span>{" "}
              <span className="text-slate-600">de IA</span>
            </div>
          </div>
          {m.lotesFallidos > 0 && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {m.lotesFallidos} lote(s) de clasificación fallaron: esos mensajes quedaron sin analizar,
              así que los números de arriba subestiman lo que hay.
            </p>
          )}
          {m.recibidos > 0 && m.senales === 0 && m.clasificados > 20 && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Están entrando mensajes pero no se detecta ninguna señal. Puede ser que estos grupos no
              sean gremiales, o que el léxico necesite ajuste.
            </p>
          )}
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold text-slate-900">La línea</h2>
      <VincularLinea sesiones={sesionesRes.data || []} asesores={asesoresRes.data || []} />

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-900">Qué escucha Sofi</h2>
      <GruposPanel grupos={grupos} />

      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Pedidos de colegas</h2>
      <p className="mb-2 text-sm text-slate-500">
        Clientes de <em>otras</em> inmobiliarias, no de Diamond — no van al embudo propio.
      </p>
      {senalesRes.hasError && <ErrorBanner message={senalesRes.message} />}
      <ul className="rounded-lg border border-slate-200 bg-white px-4">
        {demandas.length === 0 ? (
          <li className="py-4 text-sm italic text-slate-400">Nada detectado todavía.</li>
        ) : (
          demandas.map((s) => <Ficha key={s.id} s={s} />)
        )}
      </ul>

      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Propiedades de colegas</h2>
      <p className="mb-2 text-sm text-slate-500">
        Nunca son inventario propio. Confirmá disponibilidad antes de ofrecerlas a un cliente.
      </p>
      <ul className="rounded-lg border border-slate-200 bg-white px-4">
        {ofertas.length === 0 ? (
          <li className="py-4 text-sm italic text-slate-400">Nada detectado todavía.</li>
        ) : (
          ofertas.map((s) => <Ficha key={s.id} s={s} />)
        )}
      </ul>
    </div>
  );
}
