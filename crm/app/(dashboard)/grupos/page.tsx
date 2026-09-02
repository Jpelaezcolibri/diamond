import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";
import { fetchSafe, countSafe } from "@/lib/fetch-safe";
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
import {
  MandatosPanel,
  MatchesPendientesPanel,
  MatchesEncontradosPanel,
  type MatchEncontrado,
} from "@/components/mandatos-panel";
import { MensajesPorAsesoraPanel, type MensajesPorAsesora } from "@/components/mensajes-por-asesora-panel";
import DashboardMatches, { type MetricasRadar as Metricas } from "@/components/dashboard-matches";
import Carril from "@/components/carril";
import PanelPlegable from "@/components/panel-plegable";

export const dynamic = "force-dynamic";


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
  // Son conteos puros (Fix 3 de la revision final): { count: "exact", head:
  // true } en vez de select("*") + .data.length -- no trae filas (head:
  // true descarta el body igual, "*" es solo la firma de tipos), asi que no
  // choca contra el limite de max-rows de Supabase (500-1000 filas segun
  // plan) como pasaria pidiendo todas las filas para contarlas en memoria, y
  // no baja el JSON de `matches` de cada fila solo para descartarlo.
  // OJO: se probó primero con select("id", {count, head}) y SÍ disparó
  // TS2589 (Type instantiation is excessively deep) al pasar por mias() --
  // mismo síntoma que los dos casos ya documentados más abajo
  // (entradaPorAsesorQuery e idsSeñalDm): una lista de columnas angosta
  // hace que el helper genérico de mias() no logre resolver el tipo de
  // retorno. select("*", {count, head}) sí resuelve, verificado con
  // `npx tsc --noEmit`.
  const [autoDmRes, reenvioManualRes] = await Promise.all([
    countSafe(
      mias(
        supabase
          .from("group_signals")
          .select("*", { count: "exact", head: true })
          .eq("respuesta_modo", "auto")
      ),
      "grupos:auto_dm"
    ),
    countSafe(
      mias(
        supabase
          .from("group_signals")
          .select("*", { count: "exact", head: true })
          .eq("politica_motivo", "sin_telefono")
      ).not("aviso_advisor_id", "is", null),
      "grupos:reenvio_manual"
    ),
  ]);
  const autoDm = autoDmRes.count;
  const reenvioManual = reenvioManualRes.count;

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
  //
  // No hay consulta separada de asesores activos acá: sería un duplicado
  // exacto de `asesoresRes` (arriba, en el bloque de "Escucha en vivo"),
  // que ya trae { id, name, phone } de los mismos `advisors` activos.
  const [entradaPorAsesorRes, salidaPorAsesorRes] = admin
    ? await Promise.all([
        fetchSafe<{ aviso_advisor_id: string; politica_motivo: string | null }>(
          mias(supabase.from("group_signals").select("*").eq("clase", "demanda")).not(
            "aviso_advisor_id",
            "is",
            null
          ),
          "grupos:entrada_por_asesor"
        ),
        fetchSafe<{ advisor_id: string }>(
          supabase.from("mandato_match_alerts").select("advisor_id").eq("entregado", true),
          "grupos:salida_por_asesor"
        ),
      ])
    : [null, null];

  const mensajesPorAsesora: MensajesPorAsesora[] = admin
    ? (asesoresRes?.data || [])
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

  // Matches entregados por mandato, para la grilla de "Mis mandatos": se
  // cuenta sobre lo que ya vino, ninguna consulta más.
  const matchesPorMandato = new Map<string, number>();
  for (const x of matchesEncontrados) {
    matchesPorMandato.set(x.mandato_id, (matchesPorMandato.get(x.mandato_id) ?? 0) + 1);
  }

  const gruposConResponder = gruposVivos.filter((g) => g.responde).length;
  const ventasPorConfirmar = ventas.filter((v) => v.estado === "pendiente").length;

  // Rediseño (Juan, 2026-09-02, mockup aprobado): cinco zonas con jerarquía
  // -- cabecera compacta, isla oscura del dashboard, atención del día (admin),
  // grupos plegados, y los dos carriles de trabajo lado a lado. Lo de
  // configuración (cargar grupos, escucha en vivo) va plegado: casi no cambia
  // y antes ocupaba media pantalla por encima de lo que se revisa a diario.
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-slate-900">Radar de grupos</h1>
          <p className="mt-1 max-w-[62ch] text-sm text-slate-600">
            Quién busca lo que vos tenés, y qué publican los colegas que le sirve a tus compradores.
            Destilado de {grupos.length} grupo{grupos.length === 1 ? "" : "s"}: exports del chat,
            reenvíos a Sofi y, donde un administrador lo habilite, escucha en vivo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RadarToggle activo={radarActivo} puedeCambiar={admin} compacto />
          {radarActivo && <ModoRespuestaToggle modo={modoRespuesta} puedeCambiar={admin} compacto />}
        </div>
      </div>

      {gruposRes.hasError && <ErrorBanner message={gruposRes.message} />}

      {sinVincular && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Tu usuario todavía no está vinculado a una ficha de asesor, así que no
          podés subir grupos ni ver señales propias. Pedile a un administrador
          que te vincule desde <strong>Usuarios</strong>.
        </div>
      )}

      <DashboardMatches
        admin={admin}
        mandatosActivos={mandatos.length}
        pedidosConMatch={conMatch}
        pedidosPorRevisar={pendientes}
        propiedadesConMatch={matchesEncontrados.length}
        autoDm={autoDmRes.hasError ? null : autoDm}
        reenvioManual={reenvioManualRes.hasError ? null : reenvioManual}
        sinEntregar={matchesPendientes.length}
        metricas={m}
      />
      {autoDmRes.hasError && <ErrorBanner message={autoDmRes.message} />}
      {reenvioManualRes.hasError && <ErrorBanner message={reenvioManualRes.message} />}

      {/* Atención hoy -- solo admin (Juan, 2026-08-21: "pasa el inbox y las
          posibles ventas pra la parte superior... para tener mejor acceso"):
          siguen arriba, pero en tres tarjetas lado a lado con scroll propio
          en vez de tres listas apiladas a lo largo. */}
      {admin && (
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <h2
                className="font-display text-sm font-bold text-slate-900"
                title="Cruce diario: propiedades con una visita agendada (cliente directo o colega) que ya no están disponibles según Wasi. No es una venta confirmada."
              >
                Posibles ventas
              </h2>
              {ventasPorConfirmar > 0 ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
                  {ventasPorConfirmar} por confirmar
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{ventas.length}</span>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {ventasRes?.hasError && <ErrorBanner message={ventasRes.message} />}
              <PosiblesVentas ventas={ventas} embebido />
            </div>
          </div>

          <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <h2
                className="font-display text-sm font-bold text-slate-900"
                title="Mensajes directos (no de grupo) que le llegan a la línea vinculada. Solo lectura: nadie responde desde acá."
              >
                Inbox de la línea
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                {dmConPedido.length} mensaje{dmConPedido.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {dmRes?.hasError && <ErrorBanner message={dmRes.message} />}
              <LineaDmInbox mensajes={dmConPedido} embebido />
            </div>
          </div>

          <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <h2
                className="font-display text-sm font-bold text-slate-900"
                title="Entrada: avisos de pedidos de colegas que recibió cada asesora. A mano: los que le tocó reenviar porque no se resolvió el teléfono. Salida: propiedades de colegas entregadas para sus mandatos."
              >
                Mensajes por asesora
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">histórico</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {entradaPorAsesorRes?.hasError && <ErrorBanner message={entradaPorAsesorRes.message} />}
              {salidaPorAsesorRes?.hasError && <ErrorBanner message={salidaPorAsesorRes.message} />}
              <MensajesPorAsesoraPanel filas={mensajesPorAsesora} embebido />
            </div>
          </div>
        </section>
      )}

      {radarActivo && !sinVincular && (
        <PanelPlegable titulo="Cargar grupos" resumen="export .txt de WhatsApp · sin riesgo para ninguna línea">
          <ImportarExport />
        </PanelPlegable>
      )}

      <GruposPanel grupos={grupos} />

      <section className="grid items-start gap-4 xl:grid-cols-2">
        <Carril
          tono="entrada"
          titulo="Pedidos de colegas"
          descripcion="Clientes de otras inmobiliarias que buscan algo que tenés. No van al embudo propio."
          contador={conMatch}
        >
          {conMatchRes.hasError && <ErrorBanner message={conMatchRes.message} />}
          {demandasRes.hasError && <ErrorBanner message={demandasRes.message} />}
          <SenalesGrupos senales={demandas} clase="demanda" vacio="Nada detectado todavía." embebido />
        </Carril>

        <Carril
          tono="salida"
          titulo="Propiedades de colegas"
          descripcion="Solo lo que un colega publicó y le sirve a uno de tus mandatos. Nunca es inventario propio: confirmá disponibilidad antes de ofrecerla."
          contador={matchesEncontrados.length}
        >
          {matchesEncontradosRes.hasError && <ErrorBanner message={matchesEncontradosRes.message} />}
          <MatchesEncontradosPanel matches={matchesEncontrados} />
          {/* Los que no llegaron a la asesora viven en el mismo carril, en
              rojo, debajo de los entregados: es supervisión del carril de
              compra completo, por eso solo admin y sin filtro por asesor. */}
          {admin && (matchesPendientes.length > 0 || matchesPendientesRes.hasError) && (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-rose-700">
                Sin entregar · {matchesPendientes.length}
              </p>
              <p className="mb-2 text-xs text-slate-500">
                Avisos que no se le pudieron mandar al asesor dueño del mandato. Si algo se acumula acá,
                hay un problema de entrega que resolver.
              </p>
              {matchesPendientesRes.hasError && <ErrorBanner message={matchesPendientesRes.message} />}
              <MatchesPendientesPanel matches={matchesPendientes} />
            </div>
          )}
        </Carril>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">Mis mandatos de compra</h2>
            <p className="text-xs text-slate-500">
              Clientes tuyos que están buscando. Cada oferta que un colega publique y le sirva a alguno se
              te avisa por WhatsApp — no hace falta revisar esta lista para que funcione.
            </p>
          </div>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-800">
            {mandatos.length} activo{mandatos.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="p-4">
          {mandatosRes.hasError && <ErrorBanner message={mandatosRes.message} />}
          <MandatosPanel mandatos={mandatos} conteo={matchesPorMandato} />
        </div>
      </section>

      {admin && (
        <PanelPlegable
          titulo="Escucha en vivo"
          resumen={`${sesiones.length} línea${sesiones.length === 1 ? "" : "s"} · ${gruposVivos.length} grupo${gruposVivos.length === 1 ? "" : "s"} · el bot responde en ${gruposConResponder} · solo admin`}
        >
          <p className="mb-3 text-sm text-slate-500">
            Una línea dedicada de la empresa se vincula por QR y el radar lee los grupos que se
            habiliten. En los que además tengan <strong>Responder</strong> prendido, publica una
            respuesta cuando encuentra propiedades que encajan.
          </p>
          {sesionesRes?.hasError && <ErrorBanner message={sesionesRes.message} />}
          {asesoresRes?.hasError && <ErrorBanner message={asesoresRes.message} />}
          <div className="flex flex-col gap-4">
            <VincularLinea sesiones={sesiones} asesores={asesoresRes?.data || []} />
            <GruposPermisos grupos={gruposVivos} />
          </div>
        </PanelPlegable>
      )}
    </div>
  );
}
