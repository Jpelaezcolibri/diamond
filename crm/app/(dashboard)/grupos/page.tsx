import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";
import { fetchSafe } from "@/lib/fetch-safe";
import ErrorBanner from "@/components/error-banner";
import GruposPanel, { type Grupo } from "@/components/grupos-panel";
import SenalesGrupos, { type Signal } from "@/components/senales-grupos";
import ImportarExport from "@/components/importar-export";
import RadarToggle from "@/components/radar-toggle";
import ModoRespuestaToggle from "@/components/modo-respuesta-toggle";
import VincularLinea, { type Sesion, type Asesor } from "@/components/vincular-linea";
import GruposPermisos, { type GrupoVivo } from "@/components/grupos-permisos";

export const dynamic = "force-dynamic";

type Metricas = {
  dias: number; demandas: number; ofertas: number;
  demandasConMatch: number; demandasPorDia: number; ofertasPorDia: number; tasaMatch: number;
};

export default async function GruposPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = isAdmin(user);

  // Un asesor entra y ve SOLO las señales que él observó — las que salieron de
  // los exports que él subió. El guard de admin que había acá protegía un
  // modelo que ya no existe: cuando una sola línea vinculada servía a toda la
  // organización, abrir esta pantalla era ver los grupos de otra persona. Con
  // exports, cada uno sube los suyos.
  //
  // Los GRUPOS siguen siendo compartidos, porque en la realidad lo son: varias
  // asesoras están en los mismos grupos gremiales. Lo que tiene dueño es la
  // observación, no la fuente.
  const { data: miAdvisor } = await supabase
    .from("advisors").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle();
  const miAdvisorId: string | null = miAdvisor?.id ?? null;

  // Un no-admin sin fila de asesor no puede tener señales propias. Se le
  // muestra el porqué en vez de una pantalla vacía que parece un error.
  const sinVincular = !admin && !miAdvisorId;

  // El filtro se aplica en TODAS las consultas de señales, no en una sola: si
  // se olvida en alguna, un asesor ve el pedido de otro.
  const mias = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    admin || !miAdvisorId ? q : q.eq("advisor_id", miAdvisorId);

  // Una sola consulta de señales NO alcanza. Habia un `limit(300)` sobre toda
  // la tabla, ordenado por fecha, y las dos clases se separaban en memoria: el
  // 2026-07-29 entraron ~300 señales en una hora y veinte, casi todas ofertas,
  // y las demandas con match quedaron sepultadas fuera de la ventana. En
  // pantalla se veian 2 de 14 y parecia que se hubieran borrado.
  //
  // Por eso cada cosa trae su propia consulta acotada, y las demandas CON
  // match —las unicas accionables— van aparte para que ningun volumen de
  // ofertas pueda desplazarlas.
  // Estado del interruptor. Si la migración del toggle todavía no corrió, la
  // columna no existe y la consulta falla: se asume ENCENDIDO, que es el
  // comportamiento que la organización tenía antes de que el botón existiera.
  const orgRes = await supabase
    .from("organizations").select("radar_activo, grupos_respuesta_modo").limit(1).maybeSingle();
  const radarActivo = orgRes.data?.radar_activo !== false;
  // Mismo criterio que src/data/organizations.js#modoDeRespuesta: sin
  // columna (migración sin correr) o valor vacío, "asistido" es el
  // comportamiento actual en producción — nunca se asume "auto" por defecto.
  const modoRespuesta = orgRes.data?.grupos_respuesta_modo || "asistido";

  const conMatchQuery = mias(
    supabase
      .from("group_signals")
      .select("*")
      .eq("clase", "demanda")
      .neq("matches", "[]")
      .order("created_at", { ascending: false })
      .limit(200)
  );

  const [gruposRes, conMatchRes, demandasRes, ofertasRes] = await Promise.all([
    fetchSafe<Grupo>(
      supabase.from("whatsapp_groups").select("*").order("nombre"),
      "grupos:whatsapp_groups"
    ),
    fetchSafe<Signal>(conMatchQuery, "grupos:demandas_con_match"),
    fetchSafe<Signal>(
      mias(supabase.from("group_signals").select("*").eq("clase", "demanda")
        .order("created_at", { ascending: false }).limit(100)),
      "grupos:demandas"
    ),
    fetchSafe<Signal>(
      mias(supabase.from("group_signals").select("*").eq("clase", "oferta")
        .order("created_at", { ascending: false }).limit(100)),
      "grupos:ofertas"
    ),
  ]);

  // Métricas del embudo: viven en memoria del bot, no en la base. Se piden
  // acá para no obligar a abrir una terminal cada vez que se quiere mirar el
  // volumen o el costo. Si el bot no responde, la página igual carga.
  // Solo admin: son cifras de toda la organización. A un asesor que tiene 12
  // señales propias, ver "980 pedidos" no le dice nada de su trabajo.
  const metricasRes = admin ? await callBot<Metricas>("/api/grupos/metricas", {}) : null;
  const m = metricasRes?.ok ? metricasRes.data : null;

  const grupos = gruposRes.data || [];

  // Escucha en vivo — solo admin. Vincular una línea la expone a que WhatsApp la
  // banee, y habilitar la respuesta hace que el bot publique delante de 80
  // inmobiliarias competidoras. Ninguna de las dos es tarea diaria de un asesor.
  //
  // Si las migraciones de la escucha no corrieron, estas consultas fallan y la
  // sección simplemente no aparece: el resto de la pantalla sigue funcionando.
  const [sesionesRes, asesoresRes] = admin
    ? await Promise.all([
        fetchSafe<Sesion>(
          supabase.from("whatsapp_sessions").select("*").order("created_at"),
          "grupos:whatsapp_sessions"
        ),
        fetchSafe<Asesor>(
          supabase.from("advisors").select("id, name, phone").eq("activo", true).order("name"),
          "grupos:advisors"
        ),
      ])
    : [null, null];

  const sesiones = sesionesRes?.data || [];
  const gruposVivos: GrupoVivo[] = grupos.filter((g) => g.jid.endsWith("@g.us"));

  // De qué grupo salió cada señal. Sin esto el asesor lee un pedido, copia el
  // borrador… y no sabe a dónde ir a pegarlo. Se resuelve acá y no con un join
  // en la consulta: los grupos ya vienen completos para el panel de abajo, así
  // que cruzarlos en memoria no cuesta un viaje más a la base.
  const nombrePorGrupo = new Map(grupos.map((g) => [g.id, { nombre: g.nombre, jid: g.jid }]));

  // En qué quedó cada oportunidad. El historial completo vive en signal_events
  // —una fila por paso, en orden— pero la pantalla solo necesita el último para
  // pintar por dónde va. Se traen todos los eventos de las señales visibles en
  // una sola consulta, ordenados, y gana el más reciente de cada una.
  //
  // Si la migración del Learning Domain no corrió, la consulta falla y todo
  // sigue funcionando sin la marca: el producto no depende del aprendizaje.
  const idsVisibles = [
    ...(conMatchRes.data || []),
    ...(demandasRes.data || []),
    ...(ofertasRes.data || []),
  ].map((s) => s.id);

  const ultimoEvento = new Map<string, string>();
  if (idsVisibles.length > 0) {
    const { data: eventos } = await supabase
      .from("signal_events")
      .select("signal_id, tipo, created_at")
      .in("signal_id", idsVisibles)
      .order("created_at", { ascending: true });
    for (const e of eventos || []) ultimoEvento.set(e.signal_id as string, e.tipo as string);
  }

  const conGrupo = (s: Signal) => ({
    ...s,
    grupo_nombre: nombrePorGrupo.get(s.group_id)?.nombre ?? null,
    grupo_jid: nombrePorGrupo.get(s.group_id)?.jid ?? null,
    ultimo_evento: ultimoEvento.get(s.id) ?? null,
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

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Radar de grupos</h1>
      <p className="mb-6 text-sm text-slate-500">
        Un asesor está en 80 grupos con más de mil mensajes al día: nadie los lee, y el pedido
        bueno se traspapela. Acá se destila eso en lo accionable — quién busca lo que vos tenés,
        y qué publican los colegas. Los mensajes entran por tres vías: el export del chat, el
        reenvío a Sofi, y —solo en los grupos que un administrador habilite— la escucha en vivo
        desde una línea dedicada de la empresa.
      </p>

      {gruposRes.hasError && <ErrorBanner message={gruposRes.message} />}

      <RadarToggle activo={radarActivo} puedeCambiar={admin} />
      {radarActivo && <ModoRespuestaToggle modo={modoRespuesta} puedeCambiar={admin} />}

      {admin && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Escucha en vivo</h2>
          <p className="mb-3 text-sm text-slate-500">
            Una línea dedicada de la empresa se vincula por QR y el radar lee los grupos que se
            habiliten. En los que además tengan <strong>Responder</strong> prendido, publica una
            respuesta cuando encuentra propiedades que encajan.
          </p>
          <div className="flex flex-col gap-4">
            <VincularLinea sesiones={sesiones} asesores={asesoresRes?.data || []} />
            <GruposPermisos grupos={gruposVivos} />
          </div>
        </section>
      )}

      {sinVincular && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Tu usuario todavía no está vinculado a una ficha de asesor, así que no
          podés subir grupos ni ver señales propias. Pedile a un administrador
          que te vincule desde <strong>Usuarios</strong>.
        </div>
      )}

      {radarActivo && !sinVincular && (
        <div className="mb-6">
          <ImportarExport />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: grupos.length, t: "grupos cargados", d: "de exports y reenvíos" },
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
            <h2 className="text-sm font-semibold text-slate-900">El radar, últimos {m.dias} días</h2>
            <span className="text-xs text-slate-400">sale de la base, no se reinicia con los deploys</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {[
              { n: m.demandas, t: "pedidos", d: "colegas buscando algo" },
              { n: m.demandasConMatch, t: "con match", d: "los únicos accionables" },
              { n: m.ofertas, t: "propiedades", d: "publicadas por colegas" },
              { n: m.demandasPorDia.toFixed(1), t: "pedidos/día", d: "caudal del canal" },
              { n: `${Math.round(m.tasaMatch * 100)}%`, t: "tasa de match", d: "de los pedidos, cuántos podemos responder" },
            ].map((c) => (
              <div key={c.t} title={c.d}>
                <span className="text-lg font-bold tabular-nums text-slate-900">{c.n}</span>{" "}
                <span className="text-slate-600">{c.t}</span>
              </div>
            ))}
          </div>
          {m.demandas > 10 && m.tasaMatch < 0.1 && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Se detectan pedidos pero casi ninguno calza con el inventario. O estos grupos piden
              otra cosa de la que tenemos, o al inventario le faltan zonas cargadas.
            </p>
          )}
        </div>
      )}

      <h2 className="mb-1 text-lg font-semibold text-slate-900">Grupos cargados</h2>
      <p className="mb-2 text-sm text-slate-500">
        Cada archivo que subís aparece acá como un grupo.
      </p>
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
