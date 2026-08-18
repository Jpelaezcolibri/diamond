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
 */
async function trazabilidad(scope, { dias = 7, soloConAviso = false, limite = 20 } = {}) {
  if (!supabase) return { disponible: false, motivo: "sin base de datos" };

  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  let q = supabase
    .from("group_signals")
    .select("id, created_at, fecha_mensaje, clase, texto_original, autor_nombre, autor_telefono, group_id, advisor_id, aviso_advisor_id, matches, revalidacion, enviado_at, estado, origen")
    .eq("org_id", scope.orgId)
    .eq("origen", "vivo")
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(Math.min(limite, MAX_FILAS));

  // Un asesor solo ve lo suyo. El admin ve todo: es informacion de la operacion.
  if (!scope.isAdmin) q = q.eq("advisor_id", scope.viewerUid);
  if (soloConAviso) q = q.not("enviado_at", "is", null);

  let { data, error } = await q;
  if (error && esColumnaFaltante(error)) {
    let q2 = supabase
      .from("group_signals")
      .select("id, created_at, fecha_mensaje, clase, texto_original, autor_nombre, autor_telefono, group_id, advisor_id, matches, revalidacion, enviado_at, estado, origen")
      .eq("org_id", scope.orgId)
      .eq("origen", "vivo")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(Math.min(limite, MAX_FILAS));
    if (!scope.isAdmin) q2 = q2.eq("advisor_id", scope.viewerUid);
    if (soloConAviso) q2 = q2.not("enviado_at", "is", null);
    ({ data, error } = await q2);
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
      // En vivo llega el telefono; si vino como @lid no es marcable y se dice.
      contactable: Boolean(s.autor_telefono && String(s.autor_telefono).length <= 13),
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
      resultado: ultimoEvento.get(s.id) || null,
    };
  });

  return { disponible: true, dias, total: filas.length, señales: filas, resumen: resumir(filas, dias) };
}

function resumenVacio(dias) {
  return { dias, entraron: 0, conCandidatas: 0, revisadasPorSofi: 0, aprobadas: 0, avisosEnviados: 0, conResultado: 0 };
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
  const conResultado = filas.filter((f) => f.resultado);
  return {
    dias,
    entraron: filas.length,
    conCandidatas: conCandidatas.length,
    revisadasPorSofi: revisadas.length,
    aprobadas: aprobadas.length,
    avisosEnviados: enviados.length,
    conResultado: conResultado.length,
    // Los desacuerdos son el material de calibracion: donde Sofi dice que el
    // puntaje se equivoco.
    desacuerdos: revisadas.map((f) => f.sofi.desacuerdo).filter(Boolean).slice(0, 5),
  };
}

module.exports = { trazabilidad };
