// Procesa un mensaje DIRECTO (no de grupo) recibido en la linea vinculada del
// radar — inbox pasivo, con alerta cuando el hilo muestra avance real hacia
// una venta.
//
// POR QUE EXISTE (Juan, 2026-08-21): "nosotros tenemos acceso a todos los
// chats de la linea de Natalia... necesito hacer un cruce de datos de cuales
// mensajes respondio el bot y cuales el colega de regreso le respondio al
// numero de natalia y de ahi sacar las citas que se agendaron... que me
// alerte cuando se concreta una fecha y una hora de visita". Ampliado el
// mismo dia: "solo quiero que me alerte de los que llegan directamente de
// los colegas, que los guarde todos pero que solo me alerte de los colegas
// que tienen fecha y hora o conversacion de agenda o todo lo que de a
// entender que hay una posible venta".
//
// NO RESPONDE NADA. Es deliberado, no una omision: "por ahora no es
// necesario responder, solo necesito leer... y que me alerte". La linea
// vinculada ya tiene su limite de riesgo bien definido (nunca conversar 1 a
// 1 con alguien de afuera, ver la nota de diseno en src/lib/waha.js) y esto
// no lo toca — solo LEE y guarda. La unica escritura es en la base propia
// (linea_dm) y el unico WhatsApp que sale es la alerta a Juan, por la linea
// OFICIAL de Sofi (src/lib/mensaje-asesor.js), nunca por la vinculada.
//
// EXISTE SOLO PORQUE la linea es 100% dedicada al radar, sin uso personal
// (confirmado por Juan, 2026-08-21) — ver db/migrations/2026-08-21_linea_dm.sql.

const groupSignals = require("../data/group-signals");
const lineaDm = require("../data/linea-dm");
const mensajeAsesor = require("../lib/mensaje-asesor");
const { getClient } = require("../lib/anthropic");

const MODELO = process.env.CLAUDE_MODEL_GRUPOS || "claude-haiku-4-5";
const VISITAS_ALERTA_TO = process.env.RADAR_VISITAS_ALERTA_TO || "";

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hay_avance", "tipo", "fecha_hora_iso", "resumen", "confianza"],
  properties: {
    hay_avance: {
      type: "boolean",
      description:
        "¿Este hilo muestra alguna señal de que el negocio avanza hacia una posible venta? Incluye fecha y hora de visita (confirmada o propuesta), conversacion de agendar aunque no este 100% cerrada, o cualquier cosa que sugiera interes real avanzado (ej. pide mas fotos con intencion clara de mostrarselo a un cliente concreto, dice que su cliente ya lo vio y le gusto, pregunta por condiciones de negociacion). Un simple 'gracias' o pedir un link SIN mas contexto no cuenta.",
    },
    tipo: {
      type: "string",
      enum: ["cita_confirmada", "agendando", "interes_avanzado", "ninguno"],
      description:
        "cita_confirmada: fecha Y hora ya acordadas. agendando: se esta hablando de coordinar una visita, sin cerrar todavia. interes_avanzado: hay señal de posible venta pero sin agenda concreta (ej 'a mi cliente le encanto'). ninguno: no hay avance.",
    },
    fecha_hora_iso: {
      type: "string",
      description: "Si se menciono una fecha/hora (confirmada o propuesta), en ISO 8601 con offset -05:00. String vacio si no hay ninguna.",
    },
    resumen: {
      type: "string",
      description: "Una frase corta de que esta pasando en el hilo — esto lo lee Juan en el aviso, no un log.",
    },
    confianza: { type: "number", description: "0 a 1" },
  },
};

const SISTEMA = `Leés un hilo de mensajes de WhatsApp que un colega de otra inmobiliaria le escribio a un numero de Diamond Inmobiliaria, interesado en una propiedad que vio publicada en un grupo gremial.

Tu trabajo es UNA sola pregunta: ¿este hilo muestra que el negocio esta avanzando hacia una posible venta?

Como juzgar:
- Fecha y hora de visita (confirmada o propuesta) SI cuenta, aunque no este 100% cerrada — "¿puedo el jueves a las 3?" ya es señal, no hace falta que alguien responda "listo".
- Una conversacion de estar coordinando agenda ("te aviso que dia me queda bien", "dejame confirmar con mi cliente y te digo") tambien cuenta, aunque no haya fecha exacta todavia.
- Cualquier señal de interes real avanzado cuenta: "a mi cliente le gusto mucho", "cual es el margen de negociacion", "necesito mas fotos para mostrarsela hoy mismo".
- Un simple "gracias", pedir el link sin mas, o un intercambio que se corta ahi, NO cuenta — eso es ruido, no avance.
- Si hay VARIAS fechas mencionadas en el hilo, la que va en fecha_hora_iso es la MAS RECIENTE (pudo reagendar).
- Fechas relativas ("mañana", "el jueves") se resuelven contra la fecha de HOY que se te da abajo.
- Ante la duda entre avance real y charla suelta, marca hay_avance false: una alerta de mas le hace perder confianza al sistema.`;

async function clasificarAvance(mensajes, ahora) {
  if (!mensajes || mensajes.length === 0) return null;
  const hilo = mensajes.map((m) => `[${m.created_at}] ${m.texto}`).join("\n");
  try {
    const res = await getClient().messages.create({
      model: MODELO,
      max_tokens: 400,
      system: `${SISTEMA}\n\nHOY: ${ahora.toISOString()}`,
      output_config: { format: { type: "json_schema", schema: ESQUEMA } },
      messages: [{ role: "user", content: `Hilo del remitente:\n${hilo}` }],
    });
    const texto = res.content.find((b) => b.type === "text")?.text || "";
    return JSON.parse(texto);
  } catch (e) {
    console.error("[linea-dm] No se pudo clasificar el hilo:", e.message);
    return null;
  }
}

function construirAlerta(mensaje, veredicto, señal) {
  const TITULOS = {
    cita_confirmada: "📅 Cita confirmada por la línea de Natalia",
    agendando: "🗓️ Un colega esta coordinando una visita por la línea de Natalia",
    interes_avanzado: "🔥 Señal de posible venta por la línea de Natalia",
  };
  const partes = [
    TITULOS[veredicto.tipo] || "🔔 Avance en la línea de Natalia",
    ``,
    `Colega: ${mensaje.remitenteNombre || mensaje.remitenteTelefono || "sin nombre"}`,
    veredicto.fecha_hora_iso
      ? `Fecha/hora: ${new Date(veredicto.fecha_hora_iso).toLocaleString("es-CO", {
          timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
        })}`
      : null,
    `Resumen: ${veredicto.resumen}`,
    señal ? `\nPedido original: "${(señal.texto_original || "").replace(/\s+/g, " ").slice(0, 150)}"` : null,
    `\nUltimo mensaje: "${mensaje.texto}"`,
  ];
  return partes.filter(Boolean).join("\n");
}

/**
 * @param org      organizacion resuelta
 * @param mensaje  { waMessageId, sesion, remitenteTelefono, remitenteNombre, texto, fechaMensaje }
 * @returns { resultado, dmId } — nunca lanza por un mensaje suelto: un error
 *          en uno no puede tumbar la escucha de la linea.
 */
async function procesarMensaje(org, mensaje, { ahora = new Date() } = {}) {
  const señal = await groupSignals.buscarPorTelefono(org.id, mensaje.remitenteTelefono).catch(() => null);

  const { mensaje: guardado, duplicado } = await lineaDm.create(org.id, {
    sesion: mensaje.sesion,
    waMessageId: mensaje.waMessageId,
    remitenteTelefono: mensaje.remitenteTelefono,
    remitenteNombre: mensaje.remitenteNombre,
    texto: mensaje.texto,
    fechaMensaje: mensaje.fechaMensaje,
    senalId: señal ? señal.id : null,
  });
  if (duplicado) return { resultado: "duplicado" };
  if (!guardado) return { resultado: "sin_tabla" };

  const historial = await lineaDm.historialDe(org.id, mensaje.remitenteTelefono, { limite: 10 });
  const hilo = historial.length ? historial : [{ texto: mensaje.texto, created_at: guardado.created_at }];
  const veredicto = await clasificarAvance(hilo, ahora);
  if (!veredicto) return { resultado: "sin_clasificar", dmId: guardado.id };

  await lineaDm.guardarClasificacion(org.id, guardado.id, {
    tieneCita: veredicto.hay_avance,
    avanceTipo: veredicto.tipo || null,
    fechaHoraIso: veredicto.fecha_hora_iso || null,
    confianza: veredicto.confianza,
  });

  if (!veredicto.hay_avance) return { resultado: "sin_avance", dmId: guardado.id };

  // Dedup del aviso: no re-alertar el MISMO avance en cada mensaje nuevo del
  // hilo, pero SI avisar si la fecha cambio (reagenda) o si el tipo de
  // avance escalo (de "agendando" a "cita_confirmada", por ejemplo).
  const clave = veredicto.fecha_hora_iso || veredicto.tipo;
  const ultima = await lineaDm.ultimaCitaAlertada(org.id, mensaje.remitenteTelefono).catch(() => null);
  if (ultima && ultima === clave) return { resultado: "avance_ya_alertado", dmId: guardado.id };

  if (!VISITAS_ALERTA_TO) return { resultado: "sin_destinatario", dmId: guardado.id };

  const texto = construirAlerta(mensaje, veredicto, señal);
  const envio = await mensajeAsesor.enviarYRegistrar(org, VISITAS_ALERTA_TO, texto).catch((e) => ({ ok: false, error: e.message }));
  if (envio && envio.ok) await lineaDm.marcarAlertado(org.id, guardado.id).catch(() => {});

  return { resultado: envio && envio.ok ? "alertado" : "error_envio", dmId: guardado.id, error: envio && envio.error };
}

module.exports = { procesarMensaje, clasificarAvance, construirAlerta, ESQUEMA, MODELO };
