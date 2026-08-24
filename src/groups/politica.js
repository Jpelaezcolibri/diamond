// Politica de respuesta: decide si el radar habla o se calla en un grupo.
//
// Es el freno del sistema, y por eso es codigo puro y determinista: no consulta
// la base, no llama a la IA y no envia nada. Recibe hechos ya averiguados y
// devuelve una decision con su traza. Asi se puede probar entera, y asi la
// razon por la que el bot hablo (o no) queda escrita y auditable.
//
// Dos principios que ordenan todo lo de abajo:
//
//   1. CALLAR ES GRATIS. Perder una oportunidad cuesta una comision; publicar un
//      disparate ante 80 inmobiliarias competidoras cuesta la reputacion, y esa
//      no se recupera cambiando de linea.
//   2. ANTE LA DUDA, NO. Si un dato no se puede verificar —por ejemplo, si no se
//      pudo contar cuantas veces ya hablamos hoy— la respuesta es callar. Nunca
//      se asume el caso favorable.
//
// Los limites de frecuencia existen para no spamear a los colegas y para que el
// grupo no expulse a Diamond, no para disimular que hay un bot: el mensaje se
// identifica como automatico (ver src/groups/redactar.js).

const LIMITES_DEFAULT = {
  // La clasificacion de Haiku trae su propia confianza. Por debajo de esto el
  // pedido se entendio a medias, y un match sobre un pedido mal entendido es
  // peor que no responder.
  confianzaMinima: Number(process.env.GRUPOS_RESPUESTA_CONFIANZA || 0.85),
  // Tope diario de respuestas por grupo. CERO = SIN LIMITE, y ese es el default
  // por decision de producto (Juan, 2026-08-16): si entran mil solicitudes y
  // para las mil tenemos algo que ofrecer, se responden las mil. Un tope que
  // descarta pedidos buenos deja plata sobre la mesa sin mejorar la calidad de
  // lo que se publica — de la calidad ya se ocupa src/groups/publicable.js.
  //
  // Queda configurable, no borrado: si el gremio reacciona mal al volumen, se
  // pone un numero aca y se apaga sin tocar codigo.
  //
  // El "maximo 3" del producto es OTRA cosa: son las propiedades que van DENTRO
  // de una respuesta (redactar.js), no la cantidad de respuestas.
  maxPorGrupoDia: Number(process.env.GRUPOS_RESPUESTA_MAX_DIA || 0),
};

const MODOS = ["sombra", "auto"];

/**
 * Decide si se publica una respuesta.
 *
 * @param senal              la senal clasificada { clase, confianza, respondida_at }
 * @param publicables        matches que YA pasaron src/groups/publicable.js
 * @param grupo              { responde } — permiso explicito de ese grupo
 * @param modo               'sombra' | 'auto' (cualquier otra cosa apaga)
 * @param respuestasRecientes cuantas veces se hablo hoy en el grupo; null = no se pudo saber.
 *                           Solo importa si hay un tope diario configurado.
 *
 * Devuelve { publicar, motivo, traza } — `traza` lista lo que se verifico, en
 * orden, para poder auditar despues por que el bot hablo o se callo.
 */
function decidir({
  senal,
  publicables = [],
  grupo = {},
  modo = "sombra",
  respuestasRecientes = null,
  limites = LIMITES_DEFAULT,
} = {}) {
  const traza = [];
  const no = (motivo) => ({ publicar: false, motivo, traza: [...traza, `NO:${motivo}`] });

  if (!MODOS.includes(modo)) return no("modo_apagado");
  traza.push(`modo:${modo}`);

  // Escuchar un grupo y responder en el son permisos distintos. Importar una
  // linea trae de golpe todos sus grupos; sin este gate, un clic pondria al bot
  // a hablar en ochenta a la vez.
  if (grupo.responde !== true) return no("grupo_no_habilitado");
  traza.push("grupo:habilitado");

  if (!senal || senal.clase !== "demanda") return no("no_es_demanda");
  traza.push("clase:demanda");

  const confianza = Number(senal.confianza);
  if (!(confianza >= limites.confianzaMinima)) return no("confianza_baja");
  traza.push(`confianza:${confianza}`);

  // Una demanda se responde una sola vez, aunque vuelva a entrar por otro grupo
  // o por un reintento.
  if (senal.respondida_at) return no("ya_respondida");
  traza.push("sin_respuesta_previa");

  // EDIFICIO ESPECIFICO (Juan, 2026-08-21 — caso Esteban Higuita / edificio
  // Murano Plaza): "el asesor sabe donde quedan las propiedades pero en wasi
  // no las tenemos marcadas por edificio por seguridad". El puntaje del cruce
  // solo verifica zona/precio/area — nunca puede confirmar que un match sea
  // EL edificio que pidieron, sin importar que tan alto puntue. Publicar algo
  // "de Envigado" como si fuera "del edificio Murano Plaza" es exactamente el
  // tipo de dato no verificable que este radar existe para no ofrecer. Se
  // frena SIEMPRE, no solo cuando el puntaje es bajo — un match del 100% en
  // zona sigue sin decir nada sobre el edificio.
  if (senal.edificio) return no("edificio_especifico");
  traza.push("sin_edificio_especifico");

  // SIN restriccion de horario (Juan, 2026-08-20): el radar responde 24/7. Un
  // pedido a las 3 a.m. es un cliente real esperando igual que uno a mediodia,
  // y hasta ahora un match perfecto llegado antes de las 8 a.m. se callaba
  // para siempre sin ningun reintento cuando abria la ventana.
  //
  // El tope diario solo se evalua si hay uno configurado. Con el default (0,
  // sin limite) ni siquiera se exige poder contar: no habria nada que verificar.
  if (limites.maxPorGrupoDia > 0) {
    // null significa "no se pudo contar" (falta la migracion o fallo la base).
    // No es lo mismo que cero: si HAY un tope y no se puede verificar, se calla.
    if (respuestasRecientes === null || respuestasRecientes === undefined) return no("limite_no_verificable");
    if (respuestasRecientes >= limites.maxPorGrupoDia) return no("limite_alcanzado");
    traza.push(`respuestas_hoy:${respuestasRecientes}/${limites.maxPorGrupoDia}`);
  } else {
    traza.push("sin_tope_diario");
  }

  // Va al final a proposito: es la comprobacion mas cara de producir (exige
  // haber clasificado y cruzado), y ademas es la unica que no depende del
  // estado del grupo sino del inventario.
  if (!publicables.length) return no("sin_propiedades_publicables");
  traza.push(`publicables:${publicables.length}`);

  return { publicar: true, motivo: "ok", traza };
}

// ── decidirDm: el freno del DM directo al colega ─────────────────────────
//
// Distinto de `decidir` de arriba: aquella protege el GRUPO (calidad del dato,
// permiso del grupo, tope por grupo). Esta protege al COLEGA y a la LINEA —
// son ejes de riesgo distintos (spam a una persona / volumen de la linea) y
// nunca corren juntos para el mismo pedido, asi que separarlas no duplica
// nada: cada una es el freno del CANAL que le corresponde.
//
// Sigue el mismo contrato que `decidir` a proposito (codigo puro, sin I/O,
// devuelve {decision, motivo, traza}): es la forma que ya usa el radar para
// que cualquier "no" (o "si") quede auditable, y no hay razon para inventar
// una nueva aca. Quien llama (src/groups/vivo.js#asistir) es quien resuelve
// el telefono y cuenta los DMs previos; esta funcion solo decide con los
// hechos que ya le averiguaron.
//
// NINGUN limite de aca descarta un pedido: los tres desvian a la asesora
// (Juan, 2026-08-24 — "no podemos dejar pasar ningun pedido"), igual que la
// compuerta de publicables. La UNICA diferencia de fondo con `decidir` es esa:
// alla "no publicar" puede significar "nadie se entera" (ya_respondida,
// modo_apagado); aca un "no" SIEMPRE tiene una salida de respaldo.
const LIMITES_DM_DEFAULT = {
  // Dos DMs el mismo dia al mismo colega se leen como spam — es la razon de
  // ser de este limite, no una cuota de negocio.
  dmsPorColegaDia: Number(process.env.RADAR_DM_POR_COLEGA_DIA || 1),
  // Un DM por un pedido de ayer es exactamente lo que un colega reporta: "me
  // escribieron de la nada por algo que ya resolvi". Se mide contra la fecha
  // DEL MENSAJE en el grupo, nunca contra cuando se proceso la fila (ver la
  // nota de esAnteriorAlCorte en src/channels/whatsapp-group.js: si el bot
  // estuvo caido y arranca con un backlog, esos pedidos son viejos aunque la
  // fila sea de hoy).
  antiguedadMaximaMin: Number(process.env.RADAR_DM_ANTIGUEDAD_MAX_MIN || 30),
  // Cortacircuitos de volumen de LA LINEA, no una cuota: el volumen real
  // medido es ~17 pedidos/dia. Si se llega a 150 en un dia, algo se rompio
  // (un bucle, una clasificacion desbocada) y hay que frenar antes de gastar
  // la reputacion de la linea entera, no solo la de un colega.
  topeDiarioLinea: Number(process.env.RADAR_DM_TOPE_DIA || 150),
};

/**
 * Decide si se le manda un DM directo al colega.
 *
 * @param telefono        el telefono YA RESUELTO del colega, o null/undefined
 *                         si el directorio no lo pudo resolver.
 * @param fechaMensajeIso  la fecha REAL del mensaje en el grupo (nunca la de
 *                         creacion de la fila — ver la nota del limite arriba).
 * @param ahora            reloj inyectado, para poder probarlo.
 * @param dmsHoyColega      cuantos DMs ya salieron HOY para este colega, o
 *                         null si no se pudo contar (falta la migracion o
 *                         fallo la consulta).
 * @param dmsHoyLinea       cuantos DMs mando la linea HOY en total, o null si
 *                         no se pudo contar.
 *
 * Devuelve { enviarDm, motivo, traza }. Ante cualquier duda (un dato que no
 * se pudo verificar) el resultado es NO enviar — el mismo principio que
 * `decidir`: callar es gratis, un DM de mas no lo es.
 */
function decidirDm({
  telefono = null,
  fechaMensajeIso = null,
  ahora = new Date(),
  dmsHoyColega = null,
  dmsHoyLinea = null,
  limites = LIMITES_DM_DEFAULT,
} = {}) {
  const traza = [];
  const no = (motivo) => ({ enviarDm: false, motivo, traza: [...traza, `NO:${motivo}`] });

  if (!telefono) return no("sin_telefono");
  traza.push("telefono:resuelto");

  if (!fechaMensajeIso) return no("sin_fecha_mensaje");
  const edadMs = ahora.getTime() - new Date(fechaMensajeIso).getTime();
  const maxMs = limites.antiguedadMaximaMin * 60 * 1000;
  if (Number.isNaN(edadMs) || edadMs > maxMs) return no("pedido_vencido");
  traza.push(`antiguedad_min:${Math.max(0, Math.round(edadMs / 60000))}`);

  // null/undefined = "no se pudo contar" (falta la migracion o fallo la
  // consulta). No es lo mismo que cero: con un limite configurado y sin poder
  // verificarlo, se calla — igual que el tope por grupo de `decidir`.
  if (dmsHoyColega === null || dmsHoyColega === undefined) return no("limite_colega_no_verificable");
  if (dmsHoyColega >= limites.dmsPorColegaDia) return no("limite_colega_alcanzado");
  traza.push(`dms_colega_hoy:${dmsHoyColega}/${limites.dmsPorColegaDia}`);

  if (dmsHoyLinea === null || dmsHoyLinea === undefined) return no("limite_linea_no_verificable");
  if (dmsHoyLinea >= limites.topeDiarioLinea) return no("limite_linea_alcanzado");
  traza.push(`dms_linea_hoy:${dmsHoyLinea}/${limites.topeDiarioLinea}`);

  return { enviarDm: true, motivo: "ok", traza };
}

module.exports = { decidir, LIMITES_DEFAULT, MODOS, decidirDm, LIMITES_DM_DEFAULT };
