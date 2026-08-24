// Guarda una senal clasificada, venga por donde venga.
//
// Vivia dentro de src/groups/importar-export.js, que es el orquestador del
// export por archivo, y de ahi salieron dos cosas hardcodeadas que en vivo son
// falsas: `origen: "export"` y `autor_telefono: null`. Duplicar la funcion para
// el modo en vivo habria dejado dos mapeos del mismo insert divergiendo en
// silencio, que es justo el fallo que este repo ya pago una vez (D3 del EPE:
// "una copia manual diverge en silencio").
//
// La diferencia que mas importa entre las dos vias:
//
//   export   el .txt trae el NOMBRE con el que el asesor tiene agendado al
//            colega, nunca el numero. El contacto se resuelve por nombre+grupo.
//   vivo     el webhook SI trae el telefono del remitente. Es exactamente el
//            dato que falto en julio, cuando los contactos llegaron como @lid y
//            se perdieron ~100 colegas por no ser marcables.

const groupSignals = require("../data/group-signals");
const { idDeMensaje } = require("../../epe/core/hash");

/**
 * @param org           { id }
 * @param c             clasificado con su `mensaje` adjunto
 * @param origen        'export' | 'reenvio' | 'vivo'
 * @param advisorId     quien observo la senal (puede ser null)
 * @param autorTelefono telefono del remitente; solo existe en vivo
 * @param waMessageId   id del mensaje. En vivo se pasa el id REAL de WhatsApp
 *                      (prefijado) en vez de calcular el hash: es estable, ya
 *                      viene dado y evita tocar la semilla congelada del EPE (D2).
 */
async function persistirSenal(org, c, { origen = "export", advisorId = null, autorTelefono = null, waMessageId = null } = {}) {
  const m = c.mensaje;
  return groupSignals.create(org.id, {
    group_id: m.groupId,
    advisor_id: advisorId,
    // `await` obligatorio: idDeMensaje es async desde que el hash pasa por
    // WebCrypto. Sin el viajaba una Promise como wa_message_id y TODAS las
    // senales de una corrida colisionaban entre si como duplicadas — sin error,
    // solo con senales que desaparecian.
    wa_message_id: waMessageId || (await idDeMensaje(m)),
    autor_nombre: m.autor || null,
    autor_telefono: autorTelefono,
    clase: c.clase,
    confianza: c.confianza,
    operacion: c.operacion || null,
    tipo: c.tipo || null,
    zona: c.zona || null,
    ciudad: c.ciudad || null,
    precio_min: c.precio_min || null,
    precio_max: c.precio_max || null,
    habitaciones: c.habitaciones || null,
    // El resto de lo que pidio el colega (Juan, 2026-08-24): classify.js ya
    // los extraia y match.js ya los usaba para puntuar — solo faltaba
    // guardarlos. Ver la nota en group-signals.js#create.
    area_min: c.area_min || null,
    banos: c.banos || null,
    garajes: c.garajes || null,
    estrato: c.estrato || null,
    flexible_habitaciones: c.flexible_habitaciones ?? null,
    contacto: c.contacto || null,
    texto_original: m.texto || null,
    matches: c.matches || [],
    origen,
    fecha_mensaje: m.instanteIso || null,
  });
}

module.exports = { persistirSenal };
