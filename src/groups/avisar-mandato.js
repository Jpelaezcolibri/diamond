// src/groups/avisar-mandato.js
//
// Orquesta el carril de COMPRA: una oferta que un colega publico en un grupo se
// cruza contra los mandatos activos, y cada match se le manda al asesor dueño del
// mandato. Sofi NO le escribe al colega en este carril.
//
// POR QUE NO SE LE ESCRIBE AL COLEGA (Juan, 2026-08-25). Cuando VENDEMOS, el
// colega pidio: un DM es la conducta que espera, y se le ofrece lo nuestro. Acá
// el colega publico una oferta al grupo y no nos pidio nada — un DM automatico es
// un mensaje frio sobre una propiedad ajena, que es el patron que mas reportes de
// baneo tiene (ver src/lib/waha.js). Y negociar la propiedad de otro con reparto
// de comision lo tiene que hacer una persona.
//
// NINGUN MATCH MUERE EN SILENCIO. Es el principio heredado del carril de venta
// (Juan, 2026-08-20): los limites desvian, no descartan.
//
// Los modulos de envio se requieren COMPLETOS y no destructurados: destructurar
// congela la referencia y deja los tests sin forma de mockear el envio (mismo
// criterio que src/groups/vivo.js).
const mandatosData = require("../data/mandatos");
const advisors = require("../data/advisors");
const directorio = require("./directorio");
const mensajeAsesor = require("../lib/mensaje-asesor");
const ritmo = require("../lib/ritmo-avisos");
const canalWhatsapp = require("../channels/whatsapp");
const { evaluarOferta } = require("./cruce-mandatos");
const { buildMandatoMatchAlert, paramsPlantilla } = require("../notifications/mandato-aviso");

const PLANTILLA = process.env.RADAR_MANDATO_TEMPLATE || "radar_match_mandato";
// A quien se le escala un aviso que no se pudo entregar. Catherine atiende las dos
// lineas (ver el spec del 2026-08-22 §4.4), asi que es el mismo destino que ya usa
// el carril de venta cuando no puede responder solo.
const ESCALADO_TO = () => process.env.RADAR_ESCALADO_PHONE || process.env.RADAR_REVISOR_PHONE || "";

/**
 * @param oferta   propiedad del colega, shape de ally_properties
 * @param opts.allyPropertyId  id de la fila persistida (clave del dedup)
 * @param opts.colega  { lid, nombre, telefono? }
 * @returns { resultado, avisados, matches }
 *   resultado: 'sin_mandatos' | 'sin_match' | 'enviado' | 'plantilla' | 'escalado'
 */
async function cruzarOfertaConMandatos(org, oferta, opts = {}) {
  const { allyPropertyId = null, colega = {}, grupo = null, vistoEnIso = null, sesion = null, jid = null } = opts;
  if (!allyPropertyId) return { resultado: "sin_oferta", avisados: [], matches: 0 };

  const activos = await mandatosData.listarActivos(org.id);
  if (activos.length === 0) return { resultado: "sin_mandatos", avisados: [], matches: 0 };

  const cruces = [];
  for (const mandato of activos) {
    const evaluacion = evaluarOferta(oferta, mandato);
    if (evaluacion && evaluacion.sirve) cruces.push({ mandato, evaluacion });
  }
  if (cruces.length === 0) return { resultado: "sin_match", avisados: [], matches: 0 };

  // El telefono del colega se resuelve UNA vez por oferta, no una por mandato:
  // refrescar el padron de un grupo puede ser un HTTP de cientos de participantes.
  //
  // Se rompe aca a proposito la decision de ofertas.js de no tocar el directorio
  // (ese modulo solo archiva y no debe cargar con esa dependencia). Sin telefono,
  // el aviso pierde la mitad de su valor.
  let telefonoColega = colega.telefono || null;
  if (!telefonoColega && colega.lid) {
    telefonoColega = await directorio
      .telefonoDe(org.id, colega.lid, { sesion, jid })
      .catch((e) => {
        console.warn("[radar] no se pudo resolver el telefono del colega:", e.message);
        return null;
      });
  }

  const avisados = [];
  let ultimoResultado = "sin_match";
  const tope = Number(process.env.RADAR_MANDATO_MAX_DIA || 0);
  for (const { mandato, evaluacion } of cruces) {
    if (tope > 0 && (await mandatosData.avisosHoy(org.id, mandato.id)) >= tope) {
      console.log(`[radar] mandato ${mandato.id} llego al tope diario de ${tope} avisos`);
      continue;
    }

    // Se RESERVA antes de mandar: si el envio falla, el par queda registrado con
    // su error en vez de reintentarse en loop en cada repost del colega.
    const { esNuevo, id: alertaId } = await mandatosData.registrarAlerta(org.id, {
      mandatoId: mandato.id, allyPropertyId, advisorId: mandato.advisor_id, puntaje: evaluacion.puntaje,
    });
    if (!esNuevo) continue;

    const texto = buildMandatoMatchAlert({
      mandato, oferta, evaluacion,
      colega: { nombre: colega.nombre || oferta.contacto_nombre || null, telefono: telefonoColega },
      grupo, vistoEnIso,
    });

    // El destinatario del WhatsApp es SIEMPRE el asesor PRINCIPAL del radar
    // (Natalia — Juan, 2026-08-26), no quien cargo el mandato. `mandato.advisor_id`
    // sigue guardandose en registrarAlerta tal cual (es el registro de quien
    // registro el mandato, no cambia); lo unico que cambia es a quien se le
    // manda el aviso.
    const advisor = await advisors.findAsesorPrincipalRadar(org).catch(() => null);

    // FRENO DE RITMO (Juan, 2026-09-02). Este es el camino que mas ruido
    // generaba: 18 ofertas del MISMO mandato a Natalia en tres horas, tres en
    // el mismo minuto, cuatro rechazadas por WhatsApp. Si a la asesora ya se
    // le escribio hace poco, la alerta queda registrada con su texto y sin
    // entregar; la bandeja de salida la manda agrupada con las demas.
    if (advisor && advisor.id && !ritmo.puedeEnviar(advisor.id)) {
      await mandatosData.marcarEntrega(org.id, alertaId, {
        entregado: false, via: null, error: null, texto,
      });
      ultimoResultado = "en_cola";
      continue;
    }

    const entrega = advisor && advisor.phone
      ? await entregar(org, advisor.phone, texto, { mandato, oferta })
      : { ok: false, via: null, error: "mandato sin asesor con telefono" };
    if (entrega.ok && advisor && advisor.id) ritmo.registrarEnvio(advisor.id);

    await mandatosData.marcarEntrega(org.id, alertaId, {
      entregado: entrega.ok, via: entrega.via, error: entrega.error, texto,
    });

    if (entrega.ok) {
      avisados.push({ mandatoId: mandato.id, advisorPhone: advisor.phone, via: entrega.via });
      ultimoResultado = entrega.via === "plantilla" ? "plantilla" : "enviado";
      continue;
    }

    // Escalado a Catherine: SOLO si no se pudo entregar (Juan, 2026-08-25). Si
    // llego y el asesor no contesto, es asunto de el — el mandato tiene dueño.
    //
    // El resultado es "escalado" en cuanto se TOMA esta rama, sin importar si el
    // envio a Catherine tambien fallo: no hay un cuarto canal al que caer, y ese
    // caso ya queda en el log via escalar(). Nunca se reporta "no_entregado":
    // no es un resultado que el contrato documenta.
    await escalar(org, { texto, mandato, motivo: entrega.error, alertaId });
    ultimoResultado = "escalado";
  }

  return { resultado: ultimoResultado, avisados, matches: cruces.length };
}

// Texto libre primero; si Meta lo rechaza porque la ventana de 24h esta cerrada,
// la plantilla. La plantilla no arregla ningun otro tipo de fallo, asi que no se
// gasta una en un numero invalido o en un error de credenciales.
async function entregar(org, telefono, texto, { mandato, oferta }) {
  // Ventana de 24h cerrada es el caso ESPERADO en este carril (se reintenta
  // con plantilla acto seguido) — se silencia la alerta al watchdog para no
  // entrenar a ignorarlo con una falsa alarma en cada match. Si la plantilla
  // TAMBIEN falla, escalar() abajo no lleva esta opcion.
  const libre = await mensajeAsesor
    .enviarYRegistrar(org, telefono, texto, { silenciarAlertaWatchdog: true })
    .catch((e) => ({ ok: false, error: e.message }));
  if (libre && libre.ok) return { ok: true, via: "texto_libre", error: null };

  const error = (libre && libre.error) || "sin_respuesta";
  if (!mensajeAsesor.VENTANA_CERRADA.test(error)) return { ok: false, via: null, error };

  const tpl = await canalWhatsapp
    .sendWhatsAppTemplate(org, telefono, {
      name: PLANTILLA, language: "es", bodyParams: paramsPlantilla({ mandato, oferta }),
    })
    .catch((e) => ({ ok: false, error: e.message }));
  if (tpl && tpl.ok) return { ok: true, via: "plantilla", error: null };
  return { ok: false, via: null, error: `${error} | plantilla: ${(tpl && tpl.error) || "sin_respuesta"}` };
}

async function escalar(org, { texto, mandato, motivo, alertaId }) {
  const to = ESCALADO_TO();
  if (!to) {
    console.error("[radar] match sin entregar y sin RADAR_ESCALADO_PHONE configurado:", mandato.id);
    return false;
  }
  const aviso = [
    `⚠️ Este match no se le pudo entregar al asesor del mandato de ${mandato.cliente_nombre || "un cliente"}.`,
    `Motivo: ${motivo || "sin detalle"}.`,
    "",
    texto,
  ].join("\n");
  const r = await mensajeAsesor.enviarYRegistrar(org, to, aviso).catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok) await mandatosData.marcarEscalado(org.id, alertaId, to);
  else console.error("[radar] tampoco se pudo escalar el match:", r && r.error);
  return Boolean(r && r.ok);
}

module.exports = { cruzarOfertaConMandatos, escalar, PLANTILLA };
