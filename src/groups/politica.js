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

module.exports = { decidir, LIMITES_DEFAULT, MODOS };
