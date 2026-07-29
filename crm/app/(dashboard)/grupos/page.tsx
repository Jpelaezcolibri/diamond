import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";
import { fetchSafe } from "@/lib/fetch-safe";
import ErrorBanner from "@/components/error-banner";
import GruposPanel, { type Grupo } from "@/components/grupos-panel";
import VincularLinea, { type Sesion, type Asesor } from "@/components/vincular-linea";
import SenalesGrupos, { type Signal } from "@/components/senales-grupos";

export const dynamic = "force-dynamic";

type Metricas = {
  recibidos: number; prefiltrados: number; clasificados: number; senales: number;
  duplicados: number; ruido: number; historicos: number; costoUsd: number;
  lotesFallidos: number; pendientes: number; aliadas: number; alertas: number;
  repetidos: number; alertasFallidas: number;
};

export default async function GruposPage() {
  const supabase = await createClient();

  // Esconder el link del menú no es control de acceso: acá se ve qué líneas
  // están vinculadas y el contenido de los grupos gremiales. Mismo guard que
  // /usuarios.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) redirect("/inbox");

  // Una sola consulta de señales NO alcanza. Habia un `limit(300)` sobre toda
  // la tabla, ordenado por fecha, y las dos clases se separaban en memoria: el
  // 2026-07-29 entraron ~300 señales en una hora y veinte, casi todas ofertas,
  // y las demandas con match quedaron sepultadas fuera de la ventana. En
  // pantalla se veian 2 de 14 y parecia que se hubieran borrado.
  //
  // Por eso cada cosa trae su propia consulta acotada, y las demandas CON
  // match —las unicas accionables— van aparte para que ningun volumen de
  // ofertas pueda desplazarlas.
  const conMatchQuery = supabase
    .from("group_signals")
    .select("*")
    .eq("clase", "demanda")
    .neq("matches", "[]")
    .order("created_at", { ascending: false })
    .limit(200);

  const [gruposRes, conMatchRes, demandasRes, ofertasRes, sesionesRes, asesoresRes] = await Promise.all([
    fetchSafe<Grupo>(
      supabase.from("whatsapp_groups").select("*").order("nombre"),
      "grupos:whatsapp_groups"
    ),
    fetchSafe<Signal>(conMatchQuery, "grupos:demandas_con_match"),
    fetchSafe<Signal>(
      supabase.from("group_signals").select("*").eq("clase", "demanda")
        .order("created_at", { ascending: false }).limit(100),
      "grupos:demandas"
    ),
    fetchSafe<Signal>(
      supabase.from("group_signals").select("*").eq("clase", "oferta")
        .order("created_at", { ascending: false }).limit(100),
      "grupos:ofertas"
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

  // De qué grupo salió cada señal. Sin esto el asesor lee un pedido, copia el
  // borrador… y no sabe a dónde ir a pegarlo. Se resuelve acá y no con un join
  // en la consulta: los grupos ya vienen completos para el panel de abajo, así
  // que cruzarlos en memoria no cuesta un viaje más a la base.
  const nombrePorGrupo = new Map(grupos.map((g) => [g.id, { nombre: g.nombre, jid: g.jid }]));
  const conGrupo = (s: Signal) => ({
    ...s,
    grupo_nombre: nombrePorGrupo.get(s.group_id)?.nombre ?? null,
    grupo_jid: nombrePorGrupo.get(s.group_id)?.jid ?? null,
  });

  // Las que tienen match van primero y sin repetirse, después el resto por
  // fecha. Un pedido accionable no puede quedar debajo de veinte que no lo son.
  const conMatchLista = (conMatchRes.data || []).map(conGrupo);
  const yaEstan = new Set(conMatchLista.map((s) => s.id));
  const demandas = [
    ...conMatchLista,
    ...(demandasRes.data || []).filter((s) => !yaEstan.has(s.id)).map(conGrupo),
  ];
  const ofertas = (ofertasRes.data || []).map(conGrupo);

  const conMatch = conMatchLista.length;
  // Lo que falta por mirar. Es el número que importa: los otros sólo crecen.
  const pendientes = conMatchLista.filter((s) => s.estado === "nuevo").length;
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
          { n: pendientes, t: "por revisar", d: `de ${conMatch} con match` },
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
              { n: m.repetidos, t: "difundidos", d: "el mismo aviso en varios grupos: se procesa una vez" },
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
          {m.alertasFallidas > 0 && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
              <strong>{m.alertasFallidas} aviso(s) al asesor no salieron.</strong> Suele ser la
              ventana de 24 h de Meta: si el asesor no le escribió a Sofi en las últimas 24 horas,
              WhatsApp rechaza el texto libre y exige una plantilla aprobada.
            </p>
          )}
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
        Clientes de <em>otras</em> inmobiliarias, no de Diamond — no van al embudo propio. Tocá el
        botón de matches para ver qué ofrecerle y con qué mensaje.
      </p>
      {conMatchRes.hasError && <ErrorBanner message={conMatchRes.message} />}
      {demandasRes.hasError && <ErrorBanner message={demandasRes.message} />}
      <SenalesGrupos senales={demandas} clase="demanda" vacio="Nada detectado todavía." />

      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Propiedades de colegas</h2>
      <p className="mb-2 text-sm text-slate-500">
        Nunca son inventario propio. Confirmá disponibilidad antes de ofrecerlas a un cliente.
      </p>
      <SenalesGrupos senales={ofertas} clase="oferta" vacio="Nada detectado todavía." />
    </div>
  );
}
