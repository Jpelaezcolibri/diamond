// La vida completa de una oportunidad del radar, en un solo lugar.
//
// POR QUE EXISTE. El recorrido de un pedido de grupo pasa hoy por cuatro
// momentos que viven en tablas y logs distintos, y nadie puede verlos juntos:
//
//   1. llego el mensaje      group_signals (texto, grupo, autor, fecha)
//   2. el motor cruzo        group_signals.matches (puntaje, ubicacion)
//   3. Sofi decidio          group_signals.revalidacion (veredicto y por que)
//   4. salio el aviso        group_signals.enviado_at
//   5. la asesora actuo      signal_events (el resultado real)
//
// Sin esta vista, "¿esta sirviendo el radar?" solo se puede responder abriendo
// Supabase. Con ella, Juan lo pregunta en su Centro de Comando y ve la cadena
// entera: que entro, que encontro el motor, que penso Sofi, si le llego a la
// asesora y en que termino.
//
// ALCANCE. Es informacion operativa de toda la organizacion, asi que el detalle
// completo es solo para admin. Un asesor ve unicamente las senales que le
// pertenecen — mismo criterio que ya usa la pantalla de grupos.

const supabase = require("./supabase");
const contacto = require("../lib/contacto");

const MAX_FILAS = 40;

// PGRST204/42703: la columna todavia no existe (falta correr la migracion
// 2026-08-18_radar_aviso_destinatario.sql). Se degrada en vez de romper: la
// trazabilidad sigue sirviendo, solo que sin decir quien recibio el aviso.
function esColumnaFaltante(error) {
  return error?.code === "PGRST204" || error?.code === "42703";
}

function resumenMatch(m) {
  return {
    ref: m.ref,
    puntaje: m.puntaje,
    // Como calzo la ubicacion: exacta | vecina | otra_zona | ciudad. Es la
    // dimension que mas discute Sofi, asi que viaja siempre.
    ubicacion: m.ubicacion || null,
    zona: m.zona || null,
    precio: m.precio || null,
  };
}

/**
 * @param scope  { orgId, viewerUid, isAdmin } — lo arma el servidor, nunca el modelo
 * @param dias   ventana hacia atras (default 7)
 * @param soloConAviso  true = solo las que llegaron a la asesora
 * @param limite cuantas señales traer (default MAX_FILAS = 40, mismo tope)
 */
async function trazabilidad(scope, { dias = 7, soloConAviso = false, limite = MAX_FILAS } = {}) {
  if (!supabase) return { disponible: false, motivo: "sin base de datos" };

  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  // respondida_at/respuesta_* son del camino auto/sombra (marcarRespondida en
  // src/data/group-signals.js) — separado de enviado_at/aviso_advisor_id, que
  // es el aviso PRIVADO del camino asistido. Hasta el 2026-08-19 esta consulta
  // no traia ninguno de los cuatro: Sofi podia ver que el motor encontro
  // candidatas, pero no que el bot YA le habia contestado al colega en el
  // grupo, ni el texto exacto que publico — cuando el admin pedia "el mensaje
  // completo", Sofi no tenia de donde sacarlo y terminaba pidiendole que lo
  // copiara a mano del grupo.
  // politica_motivo/politica_traza (migracion 2026-08-20): por que el radar
  // callo en el camino auto/sombra. Antes ese motivo SOLO vivia en el feed de
  // chat del admin — trazabilidad_radar no lo tenia, y al preguntar "por que
  // no se envio esto" Sofi no podia leer la razon real y terminaba
  // inventando una (confundio "auto" con "asistido" y aseguro que el grupo
  // no tenia la configuracion activa, cuando el modo es de toda la org).
  const BASE = "id, created_at, fecha_mensaje, clase, texto_original, autor_nombre, autor_telefono, group_id, advisor_id, matches, revalidacion, enviado_at, respondida_at, respuesta_texto, respuesta_modo, respuesta_refs, estado, origen";
  const CON_AVISO_ADVISOR = `${BASE}, aviso_advisor_id`;
  const CON_POLITICA = `${BASE}, politica_motivo, politica_traza`;
  const COMPLETO = `${BASE}, aviso_advisor_id, politica_motivo, politica_traza`;

  function armarQuery(campos) {
    let q = supabase
      .from("group_signals")
      .select(campos)
      .eq("org_id", scope.orgId)
      .eq("origen", "vivo")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(Math.min(limite, MAX_FILAS));
    if (!scope.isAdmin) q = q.eq("advisor_id", scope.viewerUid);
    if (soloConAviso) q = q.not("enviado_at", "is", null);
    return q;
  }

  // Dos migraciones pueden faltar de forma independiente (2026-08-18 y
  // 2026-08-20), asi que se prueba de la mas completa a la mas vieja en vez
  // de un solo fallback — un solo nivel se rompia entero si faltaba
  // cualquiera de las dos que no fuera exactamente la que ese nivel asumia.
  let data, error;
  for (const campos of [COMPLETO, CON_AVISO_ADVISOR, CON_POLITICA, BASE]) {
    ({ data, error } = await armarQuery(campos));
    if (!error || !esColumnaFaltante(error)) break;
  }
  if (error) {
    // Si falta la migracion del modo asistido, se dice en vez de fallar: el
    // resto del Centro de Comando no tiene por que caerse por esto.
    return { disponible: false, motivo: error.message };
  }

  const señales = data || [];
  if (señales.length === 0) {
    return { disponible: true, dias, total: 0, señales: [], resumen: resumenVacio(dias) };
  }

  // Nombres de grupo, y de paso QUIEN recibio cada aviso — en las mismas dos
  // consultas y no en N: esto se llama desde un chat y la latencia se nota.
  //
  // Es la pieza que faltaba el 2026-08-18: sin esto Sofi no tenia forma de
  // saber a quien se le mando cada aviso, y al preguntarle, inventaba un
  // nombre. Ahora sale del dato real (aviso_advisor_id), no de una suposicion.
  const grupos = new Map();
  const idsGrupo = [...new Set(señales.map((s) => s.group_id).filter(Boolean))];
  if (idsGrupo.length) {
    const { data: gs } = await supabase.from("whatsapp_groups").select("id, nombre, jid").in("id", idsGrupo);
    for (const g of gs || []) grupos.set(g.id, g.nombre || g.jid);
  }

  const destinatarios = new Map();
  const idsDestinatario = [...new Set(señales.map((s) => s.aviso_advisor_id).filter(Boolean))];
  if (idsDestinatario.length) {
    const { data: advs } = await supabase.from("advisors").select("id, name, phone").in("id", idsDestinatario);
    for (const a of advs || []) destinatarios.set(a.id, { nombre: a.name, telefono: a.phone });
  }

  const ultimoEvento = new Map();
  const { data: eventos } = await supabase
    .from("signal_events")
    .select("signal_id, tipo, motivo, created_at")
    .in("signal_id", señales.map((s) => s.id))
    .order("created_at", { ascending: true });
  for (const e of eventos || []) ultimoEvento.set(e.signal_id, { tipo: e.tipo, motivo: e.motivo, cuando: e.created_at });

  const filas = señales.map((s) => {
    const v = s.revalidacion || null;
    const matches = (s.matches || []).map(resumenMatch);
    return {
      cuando: s.fecha_mensaje || s.created_at,
      grupo: grupos.get(s.group_id) || "(grupo desconocido)",
      colega: s.autor_nombre || "(sin nombre)",
      // En vivo llega el telefono; si vino como @lid no es marcable, y
      // contacto_wa sale null — nunca un link roto. Juan lo pidio explicito
      // (2026-08-18): el mensaje que Sofi le arma a la asesora tiene que
      // llevar el grupo, el nombre del colega Y el link para escribirle, y
      // sin este campo Sofi no tenia de donde sacar el numero — solo sabia
      // si "era contactable", nunca el dato en si.
      contactable: contacto.esMarcable(s.autor_telefono),
      contacto_wa: contacto.linkWhatsapp(s.autor_telefono),
      pidio: (s.texto_original || "").replace(/\s+/g, " ").slice(0, 220),
      motor: {
        candidatas: matches.length,
        mejor: matches.length ? Math.max(...matches.map((m) => m.puntaje || 0)) : null,
        detalle: matches,
      },
      sofi: v
        ? {
            reviso: true,
            aprobo: Boolean(v.sirve_alguna),
            refs: v.refs_utiles || [],
            por_que: v.por_que || null,
            // El desacuerdo con el puntaje es el dato que sirve para calibrar.
            desacuerdo: v.desacuerdo_con_puntaje || null,
          }
        : { reviso: false },
      aviso: s.enviado_at
        ? {
            salio: true,
            cuando: s.enviado_at,
            // null es HONESTO, no un hueco a rellenar: si la migracion no ha
            // corrido, o el aviso se mando antes de que existiera esta
            // columna, de verdad no se sabe quien lo recibio.
            para: s.aviso_advisor_id ? destinatarios.get(s.aviso_advisor_id) || null : null,
          }
        : { salio: false, motivo: v && !v.sirve_alguna ? "Sofi decidio que no servia" : "no salio" },
      // Modo auto/sombra: el bot le contesto DIRECTO al colega en el grupo (o
      // lo redacto sin publicar, si sombra). Distinto de `aviso`, que es el
      // mensaje PRIVADO a la asesora del camino asistido — un pedido puede
      // tener uno, el otro, los dos o ninguno segun el modo con el que se
      // proceso. `texto` es el texto EXACTO publicado, no un resumen: es lo
      // que hay que dar si preguntan "que mensaje mando el bot".
      // `motivo` (solo cuando salio=false) es el veredicto REAL de
      // politica.decidir — confianza_baja, sin_propiedades_publicables, etc.
      // Es la razon autoritativa de por que el radar se callo en modo
      // auto/sombra: no hay que adivinarla ni reconstruirla del feed de chat.
      // Null significa que la señal es anterior a la migracion 2026-08-20, no
      // que no se sepa el motivo.
      respuesta: s.respondida_at
        ? {
            salio: true,
            modo: s.respuesta_modo || null,
            cuando: s.respondida_at,
            texto: s.respuesta_texto || null,
            refs: s.respuesta_refs || [],
          }
        : { salio: false, motivo: s.politica_motivo || null },
      resultado: ultimoEvento.get(s.id) || null,
    };
  });

  return { disponible: true, dias, total: filas.length, señales: filas, resumen: resumir(filas, dias) };
}

function resumenVacio(dias) {
  return { dias, entraron: 0, conCandidatas: 0, revisadasPorSofi: 0, aprobadas: 0, avisosEnviados: 0, respondioBot: 0, conResultado: 0 };
}

// El resumen es lo que responde "¿esta sirviendo esto?" de un vistazo. Cada
// escalon dice donde se cae el embudo: si entran muchas y Sofi aprueba pocas, el
// problema es el inventario o el motor; si aprueba y no salen avisos, es la
// ventana de 24h; si salen y no hay resultado, es adopcion de la asesora.
function resumir(filas, dias) {
  const conCandidatas = filas.filter((f) => f.motor.candidatas > 0);
  const revisadas = filas.filter((f) => f.sofi.reviso);
  const aprobadas = filas.filter((f) => f.sofi.reviso && f.sofi.aprobo);
  const enviados = filas.filter((f) => f.aviso.salio);
  const respondidas = filas.filter((f) => f.respuesta.salio && f.respuesta.modo === "auto");
  const conResultado = filas.filter((f) => f.resultado);
  return {
    dias,
    entraron: filas.length,
    conCandidatas: conCandidatas.length,
    revisadasPorSofi: revisadas.length,
    aprobadas: aprobadas.length,
    avisosEnviados: enviados.length,
    // Solo cuenta lo PUBLICADO (modo auto), no lo redactado en sombra: sombra
    // no lo vio ningun colega, contarlo ahi infla el numero que responde
    // "¿esta sirviendo el radar?".
    respondioBot: respondidas.length,
    conResultado: conResultado.length,
    // Los desacuerdos son el material de calibracion: donde Sofi dice que el
    // puntaje se equivoco.
    desacuerdos: revisadas.map((f) => f.sofi.desacuerdo).filter(Boolean).slice(0, 5),
  };
}

module.exports = { trazabilidad };
