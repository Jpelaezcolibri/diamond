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
const ecoSofi = require("./eco-sofi");
const { getClient } = require("../lib/anthropic");

const { sinThinking } = require("./classify");
const MODELO = process.env.CLAUDE_MODEL_GRUPOS || "claude-haiku-5-5";

// INTERRUPTOR del clasificador (Juan, 2026-09-08: "por ahora solo leer,
// luego las citas"). Apagado por defecto: en fase 1 el mensaje se guarda y se
// liga al pedido, pero no se interpreta ni se alerta — y no se paga IA
// mientras no haga falta. Se lee en CADA llamada, no al cargar el modulo,
// para que prenderlo en Railway no exija un despliegue.
//
// Valores que PRENDEN, con trim+lowercase (mismo criterio que
// carril-arriendo.js#carrilActivo, al reves: aca lo raro es prender):
// "true", "1", "si", "yes". Todo lo demas, incluida la ausencia, es apagado.
const VALORES_PRENDIDO = new Set(["true", "1", "si", "yes"]);
function clasificadorActivo() {
  const valor = String(process.env.RADAR_DM_CLASIFICAR ?? "").trim().toLowerCase();
  return VALORES_PRENDIDO.has(valor);
}

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
- Manda lo ULTIMO: si el mensaje mas reciente descarta la propiedad ("no le sirve", "no le interesa la ubicacion", "ya compro", "lo dejamos"), hay_avance es false aunque antes hubiera interes o una visita hablada.
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
      // Igual que classify.js: sin thinking en Haiku 5.5 (con 400 tokens de
      // tope se comeria la respuesta).
      ...sinThinking(MODELO),
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

function construirAlerta(mensaje, veredicto, señal, nombreLinea = null) {
  const linea = nombreLinea ? `la línea de ${nombreLinea}` : "la línea del radar";
  const TITULOS = {
    cita_confirmada: `📅 Cita confirmada por ${linea}`,
    agendando: `🗓️ Un colega esta coordinando una visita por ${linea}`,
    interes_avanzado: `🔥 Señal de posible venta por ${linea}`,
  };
  const partes = [
    TITULOS[veredicto.tipo] || `🔔 Avance en ${linea}`,
    ``,
    `Colega: ${mensaje.remitenteNombre || mensaje.remitenteTelefono || "sin nombre (escribe por lid)"}`,
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
 * @param mensaje  { waMessageId, sesion, remitenteId, remitenteTelefono, remitenteLid, remitenteNombre, texto, fechaMensaje }
 *                 — remitenteTelefono y remitenteLid son excluyentes (ver
 *                 whatsapp-group.js#identidadDM).
 * @returns { resultado, dmId } — nunca lanza por un mensaje suelto: un error
 *          en uno no puede tumbar la escucha de la linea.
 */
async function procesarMensaje(org, mensaje, { ahora = new Date() } = {}) {
  const identidad = { telefono: mensaje.remitenteTelefono || null, lid: mensaje.remitenteLid || null };

  // Eco de la propia Sofi (2026-10-23): lo que Sofi le manda a Daiana por la
  // linea oficial entra aca como un DM de un contacto "Diamond". No es de
  // ningun colega: no se guarda, no se atribuye a una publicacion, no se
  // contesta. Ver ./eco-sofi.js (el bucle de respuestas_publicacion).
  if (await ecoSofi.esEcoDeSofi(org, { texto: mensaje.texto, lid: identidad.lid, telefono: identidad.telefono, ahora })) {
    console.log("[linea-dm] eco de la linea oficial de Sofi: no se registra");
    return { resultado: "eco_sofi" };
  }

  // El pedido que origino el DM: por lid si vino por lid (es lo que
  // marcarRespondida guardo en respuesta_destino_lid), por telefono si no.
  const señal = identidad.lid
    ? await groupSignals.buscarPorLid(org.id, identidad.lid).catch(() => null)
    : await groupSignals.buscarPorTelefono(org.id, identidad.telefono).catch(() => null);

  const { mensaje: guardado, duplicado } = await lineaDm.create(org.id, {
    sesion: mensaje.sesion,
    waMessageId: mensaje.waMessageId,
    remitenteTelefono: identidad.telefono,
    remitenteLid: identidad.lid,
    remitenteNombre: mensaje.remitenteNombre,
    texto: mensaje.texto,
    fechaMensaje: mensaje.fechaMensaje,
    senalId: señal ? señal.id : null,
  });
  if (duplicado) return { resultado: "duplicado" };
  if (!guardado) return { resultado: "sin_tabla" };

  // Respuesta a una publicacion nuestra (spec 2026-10-20-publicaciones-y-respuestas).
  // Falla abierta: nunca corta el camino del mensaje.
  try {
    await require("./respuestas-publicacion")
      .deLinea(org, { texto: mensaje.texto, senalId: señal ? señal.id : null, identidad, nombre: mensaje.remitenteNombre });
  } catch (_) { /* falla abierta */ }

  // Puente a Sofi (Juan, 2026-10-17): la linea no conversa, pero a la primera
  // respuesta de un colega a un DM del radar le pasa el link a Sofi con su
  // pregunta y avisa en la app. Ver src/groups/puente-sofi.js. Falla abierta:
  // si revienta, el mensaje ya quedo guardado y el resto sigue igual.
  //
  // Sofi en la linea (Juan, 2026-10-21): con RADAR_SOFI_LINEA encendido,
  // Sofi contesta hasta 3 mensajes y calla si escribio una persona. Apagado,
  // o sin la columna linea_dm.autor, sigue el puente. Ver src/groups/sofi-linea.js.
  const sofiLinea = require("./sofi-linea");
  const sofi = sofiLinea.activo()
    ? await sofiLinea.responder(org, { mensaje, señal, identidad }).catch((e) => ({ resultado: "error", error: e.message }))
    : { resultado: "apagado" };
  if (sofi.resultado !== "sin_senal" && sofi.resultado !== "apagado") {
    console.log(`[sofi-linea] ${sofi.resultado}${sofi.error ? ` (${sofi.error})` : ""} — señal ${señal ? señal.id : "-"}`);
  }
  if (sofi.resultado === "apagado" || sofi.resultado === "falta_autor") {
    const puente = await require("./puente-sofi")
      .tenderPuente(org, { mensaje, señal, identidad, dmId: guardado.id })
      .catch((e) => ({ resultado: "error", error: e.message }));
    if (puente.resultado !== "sin_senal" && puente.resultado !== "apagado") {
      console.log(`[puente-sofi] ${puente.resultado}${puente.error ? ` (${puente.error})` : ""} — señal ${señal ? señal.id : "-"}`);
    }
  }

  // Fase 1 (Juan, 2026-09-08): leer, no interpretar. Se corta ACA, despues
  // de guardar y ligar, y antes de cualquier llamada a la IA.
  if (!clasificadorActivo()) return { resultado: "guardado", dmId: guardado.id };

  // GUARD: falta la migracion 2026-09-08_linea_dm_lid.sql (revision final,
  // 2026-09-08). El escenario real es prender RADAR_DM_CLASIFICAR en Railway
  // (fase 2) mientras esa migracion sigue pendiente: sin remitente_lid,
  // ultimaCitaAlertada() de mas abajo devuelve null SIEMPRE (nunca encuentra
  // el hilo por lid), el dedup del aviso nunca frena, y sale UNA ALERTA DE
  // WHATSAPP POR CADA MENSAJE del hilo, por la linea OFICIAL de Sofi (cap de
  // ~300 mensajes por mes calendario). Un colega coordinando una visita en 8
  // mensajes son 8 alertas — esto no degrada, inunda. Se corta aca, igual
  // que la fase 1, para que prender el interruptor con la migracion
  // pendiente deje pasar como mucho la primera alerta, nunca N.
  if (lineaDm.faltaColumnaLid()) {
    console.warn(
      "[linea-dm] RADAR_DM_CLASIFICAR prendido con la migracion 2026-09-08_linea_dm_lid.sql pendiente: se guarda el mensaje pero no se clasifica ni se alerta (sin remitente_lid, el dedup de avisos no puede funcionar)."
    );
    return { resultado: "guardado_sin_columna", dmId: guardado.id };
  }

  const historial = await lineaDm.historialDe(org.id, identidad, { limite: 10 });
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
  const ultima = await lineaDm.ultimaCitaAlertada(org.id, identidad).catch(() => null);
  if (ultima && ultima === clave) return { resultado: "avance_ya_alertado", dmId: guardado.id };

  // Aviso por la campana del CRM a la duena de la linea y, si es visita, la
  // cita queda en el sistema (Juan, 2026-10-20; ver ./visita-linea.js). Ya no
  // sale por WhatsApp a RADAR_VISITAS_ALERTA_TO.
  const aviso = await require("./visita-linea")
    .avisar(org, { mensaje, veredicto, señal, identidad })
    .catch((e) => ({ ok: false, error: e.message }));
  if (aviso && aviso.motivo === "sin_asesora") return { resultado: "sin_destinatario", dmId: guardado.id };
  if (aviso && aviso.ok) await lineaDm.marcarAlertado(org.id, guardado.id).catch(() => {});

  return { resultado: aviso && aviso.ok ? "alertado" : "error_envio", dmId: guardado.id, error: aviso && aviso.error, citaLeadId: aviso && aviso.leadId };
}

module.exports = { procesarMensaje, clasificarAvance, construirAlerta, clasificadorActivo, ESQUEMA, MODELO };
