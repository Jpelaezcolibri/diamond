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
  // Cuantas veces puede hablar el bot en UN grupo por dia. Tres es suficiente
  // para ser util y poco para ser molesto.
  maxPorGrupoDia: Number(process.env.GRUPOS_RESPUESTA_MAX_DIA || 3),
  // Minimo entre dos respuestas en el mismo grupo: evita la rafaga cuando entran
  // varios pedidos juntos, que es lo que se lee como bot descontrolado.
  cooldownMinutos: Number(process.env.GRUPOS_RESPUESTA_COOLDOWN_MIN || 20),
  // Horario comercial de Colombia. Un bot contestando a las 3 de la manana no
  // ayuda a nadie y llama la atencion de la peor manera.
  horaDesde: Number(process.env.GRUPOS_RESPUESTA_HORA_DESDE || 8),
  horaHasta: Number(process.env.GRUPOS_RESPUESTA_HORA_HASTA || 19),
};

const MODOS = ["sombra", "auto"];

// Hora local de Colombia. Se usa Intl con America/Bogota igual que el resto del
// repo (src/agent/engine.js): el servidor corre en UTC y restar cinco a mano se
// rompe en los bordes del dia.
function horaEnBogota(fecha) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(fecha);
  return Number(partes.find((p) => p.type === "hour").value);
}

function dentroDeHorario(fecha, limites = LIMITES_DEFAULT) {
  const hora = horaEnBogota(fecha);
  return hora >= limites.horaDesde && hora < limites.horaHasta;
}

function minutosDesde(iso, ahora) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (ahora.getTime() - t) / 60000;
}

/**
 * Decide si se publica una respuesta.
 *
 * @param senal              la senal clasificada { clase, confianza, respondida_at }
 * @param publicables        matches que YA pasaron src/groups/publicable.js
 * @param grupo              { responde } — permiso explicito de ese grupo
 * @param modo               'sombra' | 'auto' (cualquier otra cosa apaga)
 * @param respuestasRecientes cuantas veces se hablo hoy en el grupo; null = no se pudo saber
 * @param ultimaRespuestaIso  cuando fue la ultima, para el cooldown
 * @param ahora              inyectable para poder probar horarios
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
  ultimaRespuestaIso = null,
  ahora = new Date(),
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

  if (!dentroDeHorario(ahora, limites)) return no("fuera_de_horario");
  traza.push(`hora:${horaEnBogota(ahora)}`);

  // null significa "no se pudo contar" (falta la migracion o fallo la base). No
  // es lo mismo que cero: sin poder verificar el limite, no se publica.
  if (respuestasRecientes === null || respuestasRecientes === undefined) return no("limite_no_verificable");
  if (respuestasRecientes >= limites.maxPorGrupoDia) return no("limite_alcanzado");
  traza.push(`respuestas_hoy:${respuestasRecientes}/${limites.maxPorGrupoDia}`);

  const desdeUltima = minutosDesde(ultimaRespuestaIso, ahora);
  if (desdeUltima < limites.cooldownMinutos) return no("en_cooldown");
  traza.push("cooldown:ok");

  // Va al final a proposito: es la comprobacion mas cara de producir (exige
  // haber clasificado y cruzado), y ademas es la unica que no depende del
  // estado del grupo sino del inventario.
  if (!publicables.length) return no("sin_propiedades_publicables");
  traza.push(`publicables:${publicables.length}`);

  return { publicar: true, motivo: "ok", traza };
}

module.exports = { decidir, dentroDeHorario, horaEnBogota, LIMITES_DEFAULT, MODOS };
