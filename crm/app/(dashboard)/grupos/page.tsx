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
import LineaDmInbox, { type DmMensaje } from "@/components/linea-dm-inbox";
import PosiblesVentas, { type PosibleVenta } from "@/components/posibles-ventas";
import { MandatosPanel, MatchesPendientesPanel, MatchesEncontradosPanel } from "@/components/mandatos-panel";
import { MensajesPorAsesoraPanel, type MensajesPorAsesora } from "@/components/mensajes-por-asesora-panel";
import GruposLiveWatcher from "@/components/grupos-live-watcher";

export const dynamic = "force-dynamic";

type Metricas = {
  dias: number; demandas: number; ofertas: number;
  demandasConMatch: number; demandasPorDia: number; ofertasPorDia: number; tasaMatch: number;
};

type Mandato = {
  id: string;
  cliente_nombre: string;
  operacion: string | null;
  tipo: string | null;
  zonas: string[];
  precio_max: number | null;
  habitaciones: number | null;
  area_min: number | null;
  exigencias: string[];
  estado: string;
  created_at: string;
};

type MatchPendiente = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  error: string | null;
  escalado_a: string | null;
  created_at: string;
};

type MatchEncontrado = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  entregado_at: string | null;
  escalado_a: string | null;
  texto: string | null;
  created_at: string;
  ally_properties: { mensaje_original: string | null } | null;
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

  // Mandatos de compra (Tarea 8): mismo criterio de "mias" que el resto de
  // señales — un asesor ve solo los mandatos propios, admin los ve todos.
  // Los matches sin entregar NO se filtran por asesor: son información de
  // supervisión operativa del carril de compra completo, igual que
  // `whatsapp_groups` en esta misma página.
  const [mandatosRes, matchesPendientesRes, matchesEncontradosRes] = await Promise.all([
    fetchSafe<Mandato>(
      mias(
        supabase.from("mandatos_compra").select("*").eq("estado", "activo")
          .order("created_at", { ascending: false })
      ),
      "grupos:mandatos"
    ),
    fetchSafe<MatchPendiente>(
      supabase.from("mandato_match_alerts").select("*").eq("entregado", false)
        .order("created_at", { ascending: false }).limit(50),
      "grupos:matches_pendientes"
    ),
    // Ofertas de colegas que SI hicieron match con un mandato activo (Juan,
    // 2026-09-02): reemplaza la lista vieja de "Propiedades de colegas", que
    // leia group_signals y quedo congelada el 2026-08-20 cuando se apago la
    // persistencia de ofertas sin match -- esta consulta lee mandato_match_alerts,
    // que SI sigue recibiendo filas (solo para lo que efectivamente cruzo).
    // Mismo criterio "mias" que mandatosRes: un asesor ve los matches de sus
    // propios mandatos, admin los ve todos.
    fetchSafe<MatchEncontrado>(
      mias(
        supabase.from("mandato_match_alerts").select("*, ally_properties(mensaje_original)").eq("entregado", true)
          .order("created_at", { ascending: false }).limit(100)
      ),
      "grupos:matches_encontrados"
    ),
  ]);
  const mandatos = mandatosRes.data;
  const matchesPendientes = matchesPendientesRes.data;
  const matchesEncontrados = matchesEncontradosRes.data;

  // Dashboard de matches (Juan, 2026-09-02): "de esto depende la viabilidad
  // del sistema" -- cuanto resuelve el bot completamente solo (DM directo al
  // colega, sin que ninguna asesora tenga que intervenir) contra cuanto le
  // toca reenviar a mano a la asesora (sin telefono resuelto -- el aviso le
  // llega con el texto ya armado para que ella misma se lo mande al colega).
  // Mismo filtro "mias" que el resto de la pagina -- un asesor ve solo sus
  // propias senales, admin las ve todas (ver test/crm-grupos-aislamiento.test.js).
  // select("*") y no una lista de columnas: con una lista angosta el helper
  // generico de mias() dispara TS2589 (mismo caso ya documentado mas abajo
  // en este archivo, en la consulta de idsSeñalDm).
  const [autoDmRes, reenvioManualRes] = await Promise.all([
    fetchSafe<Signal>(
      mias(supabase.from("group_signals").select("*").eq("respuesta_modo", "auto")),
      "grupos:auto_dm"
    ),
    fetchSafe<Signal>(
      mias(supabase.from("group_signals").select("*").eq("politica_motivo", "sin_telefono")).not(
        "aviso_advisor_id",
        "is",
        null
      ),
      "grupos:reenvio_manual"
    ),
  ]);
  const autoDm = autoDmRes.data.length;
  const reenvioManual = reenvioManualRes.data.length;

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

  // Mensajes por asesora (Juan, 2026-09-02): comparación admin-only entre
  // asesoras -- mismo criterio que "Matches sin entregar", no es informacion
  // que cada asesora necesite ver de si misma en esta pantalla (su propio
  // trabajo ya se ve en el resto de la pagina). La consulta a group_signals
  // SI pasa por mias() -- ver "OJO" mas abajo, es obligatorio aunque el
  // bloque entero solo corra para admin.
  // El filtro `.eq("clase", "demanda")` no acota el resultado -- `aviso_advisor_id`
  // solo se escribe en la rama de demanda de src/groups/vivo.js (manejarOferta,
  // el camino de ofertas, nunca la toca) -- pero SIN el eq, `mias()` recibiendo
  // un `select("*")` sin filtro previo dispara TS2589 (Type instantiation is
  // excessively deep), igual que el caso ya documentado de idsSeñalDm mas abajo.
  // El `.not(...)` que de verdad filtra va DESPUES de mias(), nunca dentro:
  // encadenarlo dentro tambien dispara el mismo TS2589 (probado).
  const entradaPorAsesorQuery = mias(
    supabase.from("group_signals").select("*").eq("clase", "demanda")
  ).not("aviso_advisor_id", "is", null);
  const [entradaPorAsesorRes, salidaPorAsesorRes, activosRes] = admin
    ? await Promise.all([
        fetchSafe<{ aviso_advisor_id: string; politica_motivo: string | null }>(
          entradaPorAsesorQuery,
          "grupos:entrada_por_asesor"
        ),
        fetchSafe<{ advisor_id: string }>(
          supabase.from("mandato_match_alerts").select("advisor_id").eq("entregado", true),
          "grupos:salida_por_asesor"
        ),
        fetchSafe<{ id: string; name: string }>(
          supabase.from("advisors").select("id, name").eq("activo", true),
          "grupos:advisores_activos_mensajes"
        ),
      ])
    : [null, null, null];

  const mensajesPorAsesora: MensajesPorAsesora[] = admin
    ? (activosRes?.data || [])
        .map((a) => {
          const propias = (entradaPorAsesorRes?.data || []).filter((f) => f.aviso_advisor_id === a.id);
          return {
            id: a.id,
            nombre: a.name,
            entrada: propias.length,
            reenvioManual: propias.filter((f) => f.politica_motivo === "sin_telefono").length,
            salida: (salidaPorAsesorRes?.data || []).filter((f) => f.advisor_id === a.id).length,
          };
        })
        .filter((f) => f.entrada > 0 || f.salida > 0)
    : [];

  // Inbox de la línea vinculada y "Posibles ventas" (Juan, 2026-08-21): mismo
  // criterio de admin-only que el resto de "Escucha en vivo" — es la misma
  // línea sensible, no tarea diaria de un asesor. Ambas consultas se
  // degradan solas si las migraciones del 2026-08-21 todavía no corrieron.
  const [dmRes, ventasRes] = admin
    ? await Promise.all([
        fetchSafe<DmMensaje>(
          supabase
            .from("linea_dm")
            .select("id, remitente_telefono, remitente_nombre, texto, created_at, tiene_cita, avance_tipo, cita_fecha_hora_iso, senal_id")
            .order("created_at", { ascending: false })
            .limit(300),
          "grupos:linea_dm"
        ),
        fetchSafe<PosibleVenta>(
          supabase
            .from("visita_venta_alertas")
            .select("id, ref, visita_quien, visita_origen, visita_fecha_hora_iso, alertado_at, estado")
            .order("alertado_at", { ascending: false })
            .limit(200),
          "grupos:visita_venta_alertas"
        ),
      ])
    : [null, null];

  // Pedido original de cada hilo de DM, resuelto via group_signals.senal_id
  // (un solo viaje a la base para todos los hilos, no uno por hilo).
  const dmMensajes = dmRes?.data || [];
  const idsSeñalDm = [...new Set(dmMensajes.map((m) => m.senal_id).filter(Boolean))] as string[];
  const pedidoPorSeñal = new Map<string, string | null>();
  if (idsSeñalDm.length > 0) {
    // select("*") y no una lista de columnas: con una lista angosta el
    // helper generico de mias() dispara TS2589 (no logra resolver el tipo
    // de retorno). El aislamiento por asesor sigue siendo el mismo filtro,
    // sin excepciones — ver test/crm-grupos-aislamiento.test.js.
    const { data: señales } = await mias(
      supabase.from("group_signals").select("*").in("id", idsSeñalDm)
    );
    for (const s of (señales || []) as { id: string; texto_original: string | null }[]) {
      pedidoPorSeñal.set(s.id, s.texto_original);
    }
  }
  const dmConPedido: DmMensaje[] = dmMensajes.map((m) => ({
    ...m,
    pedido_original: m.senal_id ? pedidoPorSeñal.get(m.senal_id) ?? null : null,
  }));

  // Título/link de cada propiedad de "Posibles ventas" — se lee de
  // `properties`, no se arrastra desde el aviso: precio y disponibilidad
  // pueden haber cambiado desde que se avisó.
  const ventasCrudas = ventasRes?.data || [];
  const refsVentas = [...new Set(ventasCrudas.map((v) => v.ref))];
  const propiedadPorRef = new Map<string, { titulo: string | null; link: string | null }>();
  if (refsVentas.length > 0) {
    const { data: props } = await supabase
      .from("properties").select("ref, titulo, link").in("ref", refsVentas);
    for (const p of props || []) {
      propiedadPorRef.set(p.ref as string, { titulo: p.titulo as string | null, link: p.link as string | null });
    }
  }
  const ventas: PosibleVenta[] = ventasCrudas.map((v) => ({
    ...v,
    propiedad: propiedadPorRef.get(v.ref) ?? null,
  }));

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

      {/* Arriba de todo (Juan, 2026-08-21: "pasa el inbox y las posibles
          ventas pra la parte superior... para tener mejor acceso"): son los
          dos paneles que se revisan a diario, antes que la configuración de
          "Escucha en vivo" (vincular línea, permisos), que casi no cambia. */}
      {admin && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Posibles ventas</h2>
          <p className="mb-3 text-sm text-slate-500">
            Cruce diario: propiedades con una visita agendada (cliente directo o colega) que ya no
            están disponibles según Wasi. No es una venta confirmada — puede haberse retirado o
            vendido por otro medio. Confirmá o descartá para llevar el conteo real.
          </p>
          {ventasRes?.hasError && <ErrorBanner message={ventasRes.message} />}
          <PosiblesVentas ventas={ventas} />
        </section>
      )}

      {admin && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Inbox de la línea vinculada</h2>
          <p className="mb-3 text-sm text-slate-500">
            Mensajes directos (no de grupo) que le llegan a esa línea — nadie responde desde acá,
            es solo lectura. Cuando un hilo muestra fecha de visita, coordinación de agenda, o
            cualquier señal de posible venta, queda marcado.
          </p>
          {dmRes?.hasError && <ErrorBanner message={dmRes.message} />}
          <LineaDmInbox mensajes={dmConPedido} />
        </section>
      )}

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

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Dashboard de matches</h2>
        <GruposLiveWatcher />
      </div>
      <p className="mb-2 text-sm text-slate-500">
        De un vistazo: qué estamos buscando y qué ya calzó, en los dos carriles (pedidos de colegas
        contra nuestro inventario, y ofertas de colegas contra los mandatos de compra).
      </p>
      <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { n: mandatos.length, t: "mandatos activos", d: "clientes propios buscando" },
          { n: conMatch, t: "pedidos con match", d: `${pendientes} por revisar` },
          { n: matchesEncontrados.length, t: "propiedades con match", d: "ofertas que sirven a un mandato" },
          { n: autoDm, t: "bot resolvió solo", d: "DM directo al colega, sin asesora" },
          { n: reenvioManual, t: "asesora reenvió a mano", d: "sin teléfono resuelto" },
          ...(admin ? [{ n: matchesPendientes.length, t: "sin entregar", d: "matches que no llegaron a la asesora" }] : []),
        ].map((c) => (
          <div key={c.t} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-2xl font-bold tabular-nums text-slate-900">{c.n}</p>
            <p className="text-xs font-medium text-slate-700">{c.t}</p>
            <p className="text-xs text-slate-400">{c.d}</p>
          </div>
        ))}
      </div>
      {autoDm + reenvioManual > 0 && (
        <p className="mb-6 text-xs text-slate-400">
          {autoDm} de {autoDm + reenvioManual} pedidos con teléfono ubicable los resolvió el bot
          solo, sin que nadie tuviera que escribirle a un colega.
        </p>
      )}

      {admin && mensajesPorAsesora.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Mensajes por asesora</h2>
          {entradaPorAsesorRes?.hasError && <ErrorBanner message={entradaPorAsesorRes.message} />}
          {salidaPorAsesorRes?.hasError && <ErrorBanner message={salidaPorAsesorRes.message} />}
          <MensajesPorAsesoraPanel filas={mensajesPorAsesora} />
        </div>
      )}

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

      <h2 className="mb-1 text-lg font-semibold text-slate-900">Grupos</h2>
      <p className="mb-2 text-sm text-slate-500">
        {grupos.length} grupo{grupos.length === 1 ? "" : "s"} cargado{grupos.length === 1 ? "" : "s"}, de
        exports y reenvíos.
      </p>
      <GruposPanel grupos={grupos} />

      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Match: pedidos de colegas</h2>
      <p className="mb-2 text-sm text-slate-500">
        Clientes de <em>otras</em> inmobiliarias, no de Diamond — no van al embudo propio. Tocá el
        botón de matches para ver qué ofrecerle y con qué mensaje.
      </p>
      {conMatchRes.hasError && <ErrorBanner message={conMatchRes.message} />}
      {demandasRes.hasError && <ErrorBanner message={demandasRes.message} />}
      <SenalesGrupos senales={demandas} clase="demanda" vacio="Nada detectado todavía." />

      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Match: propiedades de colegas</h2>
      <p className="mb-2 text-sm text-slate-500">
        Solo lo que un colega publicó y le sirve a alguno de tus mandatos de compra — nunca son
        inventario propio, confirmá disponibilidad antes de ofrecerlas a un cliente. Lo que no hace
        match con nada no se guarda.
      </p>
      {matchesEncontradosRes.hasError && <ErrorBanner message={matchesEncontradosRes.message} />}
      <MatchesEncontradosPanel matches={matchesEncontrados} />

      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Mis mandatos de compra</h2>
      <p className="mb-2 text-sm text-slate-500">
        Clientes tuyos que están buscando. Cada oferta que un colega publique y le sirva
        a alguno se te avisa por WhatsApp — no hace falta revisar esta lista para que funcione.
      </p>
      {mandatosRes.hasError && <ErrorBanner message={mandatosRes.message} />}
      <MandatosPanel mandatos={mandatos} />

      {admin && (
        <>
          <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Matches sin entregar</h2>
          <p className="mb-2 text-sm text-slate-500">
            Avisos que no se le pudieron mandar al asesor dueño del mandato. Ninguno debería
            quedar acá mucho tiempo — si algo se acumula, hay un problema de entrega que resolver.
          </p>
          {matchesPendientesRes.hasError && <ErrorBanner message={matchesPendientesRes.message} />}
          <MatchesPendientesPanel matches={matchesPendientes} />
        </>
      )}
    </div>
  );
}
