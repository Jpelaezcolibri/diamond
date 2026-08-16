// Procesa UN mensaje de grupo en tiempo real y decide si responde.
//
// El orquestador que ya existia (src/groups/importar-export.js) esta acoplado a
// archivos .txt: recibe buffers, arma grupos virtuales con prefijo "export" y
// reporta progreso para una barra. Nada de eso sirve para un mensaje suelto que
// acaba de llegar. Las ETAPAS puras, en cambio, sirven tal cual: todas aceptan
// un array de uno.
//
// El envio se INYECTA (`enviar`). No es un detalle de testeo: es lo que mantiene
// la capacidad de publicar en un solo lugar auditable —el transporte— en vez de
// repartirla por el pipeline. Este modulo decide QUE decir; no sabe como sale.
//
// Orden de las etapas y por que:
//   1. prefiltro lexico   gratis, descarta ~85% antes de gastar un token
//   2. clasificacion      Haiku, ~0.001 USD por mensaje suelto
//   3. cruce              codigo puro contra el inventario
//   4. persistencia       la senal vale aunque despues se decida callar
//   5. compuerta+politica lo ultimo: son las unicas que pueden publicar

const epe = require("../../epe/core");
const { classify } = require("./classify");
const { cruzar } = require("./match");
const { guardarOferta } = require("./ofertas");
const { persistirSenal } = require("./persistir");
const publicable = require("./publicable");
const politica = require("./politica");
const redactar = require("./redactar");
const groupSignals = require("../data/group-signals");
const organizations = require("../data/organizations");

const VENTANA_LIMITE_HORAS = 24;

// El id de la senal en vivo NO se calcula con el hash del EPE: WhatsApp ya trae
// un id unico y estable por mensaje. Se prefija para que convivan las tres vias
// (export:, reenvio:, vivo:) en la misma columna sin colisionar, y para no tocar
// la semilla congelada de D2, que es contrato persistido.
function idEnVivo(waMessageId) {
  return `vivo:${waMessageId}`;
}

/**
 * @param org      organizacion resuelta
 * @param mensaje  { id, texto, autor, autorTelefono, instanteIso, esSistema,
 *                   esMultimedia, groupId, waMessageId }
 * @param grupo    fila de whatsapp_groups; `responde` decide si puede contestar
 * @param modo     'sombra' (redacta y no publica) | 'auto' (publica)
 * @param enviar   async (texto) => { ok, wamid } — lo provee el transporte
 * @param asesor   a quien se deriva en el mensaje (se resuelve afuera)
 *
 * Devuelve siempre un objeto con `resultado`, para poder medir la corrida sin
 * leer logs. Nunca lanza por un mensaje suelto: un error en uno no puede tumbar
 * la escucha del grupo.
 */
async function procesarMensaje(org, mensaje, { grupo, modo = "sombra", enviar = null, asesor = null, advisorId = null, ahora = new Date() } = {}) {
  // Mismo interruptor que apaga el import: si el radar esta apagado no se gasta
  // un token ni se escribe una fila.
  if (!organizations.radarEncendido(org)) return { resultado: "radar_apagado" };

  // 1. Prefiltro. `procesar` acepta un array de uno sin cambios; el corte
  // temporal no aplica en vivo (el mensaje acaba de llegar) y el tope tampoco.
  const { aEnviar } = await epe.procesar([mensaje], { dias: null });
  if (!aEnviar.length) return { resultado: "descartado_prefiltro" };

  // 2. Clasificacion.
  const { clasificados } = await classify(aEnviar);
  const c = clasificados[0];
  if (!c) return { resultado: "sin_clasificar" };

  // El ruido muere aca, en memoria, sin tocar disco: invariante de privacidad
  // del Radar. La mayoria de los mensajes de un grupo gremial son ruido.
  if (c.clase === "ruido") return { resultado: "ruido" };

  // 3. Cruce contra inventario propio y aliados.
  const { demandas, ofertas } = await cruzar([c], { org });
  const señal = demandas[0] || ofertas[0];
  señal.mensaje = { ...mensaje, groupId: grupo.id };

  // 4. Persistencia. Va antes de decidir: la senal es valiosa aunque despues se
  // resuelva callar, y el digest de la manana la va a usar igual.
  const { signal, duplicado } = await persistirSenal(org, señal, {
    origen: "vivo",
    advisorId,
    autorTelefono: mensaje.autorTelefono || null,
    waMessageId: idEnVivo(mensaje.waMessageId || mensaje.id),
  });
  if (duplicado) return { resultado: "duplicado" };

  // Las ofertas alimentan la red de aliados y no se responden nunca: contestarle
  // a un colega que publica su propiedad no tiene sentido comercial.
  if (c.clase === "oferta") {
    if (señal.utilizable) await guardarOferta(org, señal, { vistoEn: mensaje.instanteIso });
    return { resultado: "oferta", signalId: signal && signal.id };
  }

  // 5. Compuerta de calidad del dato, y despues politica de conducta. Son dos
  // preguntas distintas: "¿este dato es publicable?" y "¿corresponde hablar?".
  const { publicables, descartados } = publicable.filtrar(señal.matches || []);

  const recientes = await groupSignals.respuestasDesde(
    org.id,
    grupo.id,
    new Date(ahora.getTime() - VENTANA_LIMITE_HORAS * 3600 * 1000).toISOString()
  );

  const decision = politica.decidir({
    senal: { clase: c.clase, confianza: c.confianza, respondida_at: signal && signal.respondida_at },
    publicables,
    grupo,
    modo,
    respuestasRecientes: recientes ? recientes.cantidad : null,
    ultimaRespuestaIso: recientes ? recientes.ultimaIso : null,
    ahora,
  });

  if (!decision.publicar) {
    return { resultado: "callado", motivo: decision.motivo, traza: decision.traza, descartados, signalId: signal && signal.id };
  }

  const texto = redactar.mensajeGrupo({ autor_nombre: mensaje.autor }, publicables, { asesor });
  if (!texto) return { resultado: "callado", motivo: "sin_texto", traza: decision.traza, signalId: signal && signal.id };

  // En sombra se redacta y se registra, pero NO se publica. Es la prueba de humo
  // que valida la calidad del mensaje sin que nadie en el grupo vea nada.
  if (modo === "sombra") {
    await groupSignals.marcarRespondida(org.id, signal.id, { texto, wamid: null, modo: "sombra" });
    return { resultado: "sombra", texto, publicables, traza: decision.traza, signalId: signal.id };
  }

  if (typeof enviar !== "function") {
    return { resultado: "callado", motivo: "sin_transporte", traza: decision.traza, signalId: signal.id };
  }

  const envio = await enviar(texto);
  if (!envio || !envio.ok) {
    return { resultado: "error_envio", error: envio && envio.error, traza: decision.traza, signalId: signal.id };
  }

  // Se registra DESPUES de que salio, con el id real del mensaje publicado: si
  // manana un colega reclama por lo que se dijo, la unica respuesta honesta es
  // mostrar el texto tal como salio.
  await groupSignals.marcarRespondida(org.id, signal.id, { texto, wamid: envio.wamid, modo: "auto" });
  return { resultado: "publicado", texto, wamid: envio.wamid, publicables, traza: decision.traza, signalId: signal.id };
}

module.exports = { procesarMensaje, idEnVivo, VENTANA_LIMITE_HORAS };
