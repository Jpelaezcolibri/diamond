// Sofi contesta en la linea del radar (Juan, 2026-10-21).
//
// Caso: Luz Amparo (Projency) respondio un DM del radar con "Cordial saludo,
// soy Luz Amparo Restrepo de Projency Inmobiliaria. Cual es tu nombre". La
// linea le mando el texto fijo del puente ("¡Hola Projency! ... te paso con
// Sofi") y un link que repetia su saludo; insistio a los 8 minutos y nadie le
// contesto en 40. Juan: "que se presente, que diga quien es y por que ofrece
// la otra linea para agendamientos, pero si puedes atender los primeros
// mensajes para no quedar tan groseros".
//
// Lo que hace, a cada mensaje de un colega a la linea del radar:
//   1. Si una persona del equipo escribio alguna vez en ese chat, calla para
//      siempre (aviso por la campana, como hoy).
//   2. Si ya contesto 3 veces en 7 dias, calla y le avisa a la asesora.
//   3. Si no, redacta con la IA una respuesta corta: se presenta como Sofi, la
//      asistente virtual; contesta con el pedido y las fichas que ya le
//      mandamos; y para mas opciones o agendar lleva a la linea oficial.
// No busca inventario ni agenda por esta linea: es WAHA, la del baneo de
// julio (Juan acepto el riesgo de conversar, no el de mandar fichas nuevas).
//
// Interruptor: RADAR_SOFI_LINEA (apagado por defecto). Apagado, o sin la
// columna linea_dm.autor, sigue el puente de siempre (puente-sofi.js).
// Spec: docs/superpowers/specs/2026-10-21-sofi-en-linea-radar-design.md

const { linkContactoOficial } = require("../lib/contacto");
const { quitarLinksInventados } = require("../agent/links-verificados");
const { primerNombre, lineaComision } = require("./redactar");
const { SALUDA_A_SOFI } = require("./puente-sofi");

const MAX_RESPUESTAS = 3;
const VENTANA_MS = 7 * 24 * 60 * 60 * 1000;
const PAUSA_MIN_MS = 8000;
const PAUSA_RANGO_MS = 12000;
const VALORES_ENCENDIDO = new Set(["true", "1", "si", "sí", "on"]);

function activo() {
  return VALORES_ENCENDIDO.has(String(process.env.RADAR_SOFI_LINEA ?? "").trim().toLowerCase());
}

const SISTEMA = `Eres Sofi, la asistente virtual de Diamond Inmobiliaria (Medellín). Escribes por la línea de WhatsApp desde la que le enviamos a un colega inmobiliario las fichas que respondían a un pedido suyo. El colega te acaba de escribir por esa misma línea.

QUÉ HACES:
- Contestas corto y cordial, como una persona del gremio: máximo 3 frases.
- En la RESPUESTA 1 te presentas: "Soy Sofi, la asistente virtual de Diamond Inmobiliaria". Si te pregunta el nombre o con quién habla, esa es la respuesta.
- Explicas por qué existe la otra línea: por esta línea solo le enviamos las fichas de su pedido; en nuestra línea oficial le muestras más opciones y le agendas la visita con la asesora. Le das el LINK OFICIAL que viene en los datos, copiado tal cual.
- Si pregunta algo de las fichas que le enviamos (precio, zona, alcobas, baños, parqueaderos, área, administración, disponibilidad), contestas con los DATOS REALES DE LAS FICHAS. Un dato que no está ahí no lo inventas: le dices que se lo confirmas en la línea oficial.
- Si pide más opciones, fotos, visita, precio negociable o hablar con alguien, lo llevas a la línea oficial con el link. La visita la agendas TÚ en la línea oficial (le propones horarios ahí); no digas que la coordina con la asesora.
- En las respuestas 2 y 3 no te vuelves a presentar, salvo que vuelva a preguntar quién eres. Repites el link solo si pide algo que se resuelve en la línea oficial; a un "gracias" o "mucho gusto" contestas corto y sin link.

REGLAS FIJAS:
- Tuteas, en un registro profesional y cercano. Nunca voseo.
- Nunca nombras a las asesoras ni das celulares: hablas de "la asesora".
- Solo usas links que vengan en los datos (el linkWasi de una ficha o el link oficial). Nunca armas uno.
- Saludas por el nombre que te dan en NOMBRE PARA SALUDAR; si viene vacío, saludas sin nombre (nunca con el nombre de una empresa).
- No prometes horarios, descuentos ni cifras que no estén en los datos.
- Sin emojis de más: uno como mucho.

Devuelves solo el texto del mensaje.`;

const ESQUEMA = {
  type: "object",
  properties: { texto: { type: "string", description: "El mensaje para el colega" } },
  required: ["texto"],
  additionalProperties: false,
};

// "Projency Inmobiliaria" es una empresa, no una persona: se saluda con el
// nombre que la persona dice en el mensaje ("soy Luz Amparo"), o sin nombre.
const PRESENTACION = /\b(?:[Ss]oy|[Mm]e llamo|[Mm]i nombre es|[Tt]e habla|[Hh]abla)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/;
const EMPRESA = /\b(inmobiliari[ao]s?|inversiones|propiedades|bienes|ra[ií]ces|inmuebles|grupo|agencia|asesores|realty|constructora|s\.?a\.?s?\.?|ltda|&)\b/i;

function nombreParaSaludo(remitenteNombre, texto) {
  const dicho = String(texto || "").match(PRESENTACION);
  if (dicho) return dicho[1];
  if (EMPRESA.test(String(remitenteNombre || ""))) return null;
  return primerNombre(remitenteNombre);
}

// El link a la linea oficial con el codigo del pedido. NO lleva el texto del
// colega: en el caso de Luz Amparo el link repetia su saludo entero.
function linkOficial(org, codigo) {
  return linkContactoOficial(org, codigo ? `Hola Sofi, sobre mi PEDIDO (cód. ${codigo})` : "Hola Sofi");
}

function textoFijo(nombre, link) {
  const saludo = nombre ? `¡Hola ${nombre}!` : "¡Hola!";
  return `${saludo} Soy Sofi, la asistente virtual de Diamond Inmobiliaria. Por esta línea te enviamos las fichas de tu pedido; para mostrarte más opciones y agendarte la visita con la asesora te atiendo en nuestra línea oficial 👉 ${link}`;
}

function lineaFicha(p) {
  const datos = [
    [p.tipo, p.operacion].filter(Boolean).join(" en "),
    [p.zona, p.ciudad].filter(Boolean).join(", "),
    p.precio,
    p.area,
    p.habitaciones != null ? `${p.habitaciones} alcobas` : null,
    p.banos != null ? `${p.banos} baños` : null,
    p.garaje != null ? `${p.garaje} parqueaderos` : null,
    p.estrato ? `estrato ${p.estrato}` : null,
    p.administracion ? `administración ${p.administracion}` : null,
  ].filter(Boolean).join(" · ");
  const estado = p.disponible === false ? " · YA NO ESTÁ DISPONIBLE" : "";
  return `- Ref ${p.ref}: ${datos}${estado}${p.linkWasi ? `\n  linkWasi: ${p.linkWasi}` : ""}`;
}

function armarUsuario({ numero, nombre, señal, fichas, hilo, link, org }) {
  const comision = String(process.env.RADAR_LINEA_COMISION || "").trim() ? lineaComision(org) : null;
  return [
    `RESPUESTA ${numero} DE ${MAX_RESPUESTAS}.`,
    `NOMBRE PARA SALUDAR: ${nombre || ""}`,
    `LINK OFICIAL: ${link}`,
    comision ? `COMISIÓN (si pregunta, repite exactamente): ${comision}` : null,
    señal && señal.texto_original ? `\nSU PEDIDO EN EL GRUPO: "${String(señal.texto_original).replace(/\s+/g, " ").slice(0, 400)}"` : "\nSIN PEDIDO LIGADO.",
    fichas.length ? `\nDATOS REALES DE LAS FICHAS QUE LE ENVIAMOS (son del inmueble, no del pedido):\n${fichas.map(lineaFicha).join("\n")}` : "\nNO TENEMOS FICHAS ENVIADAS A ESTE COLEGA.",
    `\nCONVERSACIÓN EN ESTA LÍNEA (más viejo primero):\n${hilo.map((m) => `${m.direccion === "salida" ? "NOSOTROS" : "COLEGA"}: ${String(m.texto || "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}`,
  ].filter((l) => l !== null).join("\n");
}

async function redactarConIA({ sistema, usuario }) {
  const { getClient, paramsDeModelo } = require("../lib/anthropic");
  const config = require("../config");
  const res = await getClient().messages.create({
    ...paramsDeModelo(config.claudeModel, { maxTokens: 600, sinThinking: true, outputConfig: { format: { type: "json_schema", schema: ESQUEMA } } }),
    system: sistema,
    messages: [{ role: "user", content: usuario }],
  });
  const texto = res.content.find((b) => b.type === "text")?.text || "";
  return String(JSON.parse(texto).texto || "").trim() || null;
}

function depsPorDefecto() {
  return {
    estado: (orgId, identidad, opts) => require("../data/linea-dm").estadoConversacion(orgId, identidad, opts),
    esColega: async (orgId, identidad) => {
      const supabase = require("../data/supabase");
      if (!supabase) return null;
      const lid = String(identidad.lid || "").replace(/@.*$/, "");
      let q = supabase.from("colegas_grupos").select("nombre").eq("org_id", orgId);
      if (lid) q = q.eq("lid", lid);
      else if (identidad.telefono) q = q.eq("telefono", identidad.telefono);
      else return null;
      const { data } = await q.limit(1);
      return (data && data[0]) || null;
    },
    asignarCodigo: (orgId, signalId) => require("./codigo-colega").asignarCodigo(orgId, signalId),
    fichas: async (org, refs) => {
      const properties = require("../data/properties");
      const filas = await Promise.all(refs.slice(0, 3).map((ref) => properties.findByRef(org, String(ref)).catch(() => null)));
      return filas.filter(Boolean);
    },
    redactar: redactarConIA,
    enviar: (args) => require("./envio-colega").enviarAlColega(args),
    guardarSalida: (orgId, fields) => require("../data/linea-dm").create(orgId, fields),
    asesor: (org) => require("../data/advisors").findAsesorPrincipalRadar(org),
    notificar: (args) => require("../notifications/notificar").notificar(args),
    marcarPuente: (orgId, identidad) => require("../data/respuestas-publicacion").marcarPuente(orgId, identidad),
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
    rand: Math.random,
  };
}

function recortar(texto, max) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

/**
 * @returns {{ resultado: "apagado"|"sin_senal"|"falta_autor"|"humano_atiende"|"tope"|"respondido"|"respondido_fijo"|"envio_fallido"|"error", error? }}
 * Con "apagado" o "falta_autor", quien llama sigue con el puente de siempre.
 */
async function responder(org, { mensaje, señal, identidad }, deps = null, { ahora = new Date() } = {}) {
  if (!activo()) return { resultado: "apagado" };
  if (!org) return { resultado: "sin_senal" };
  const d = deps || depsPorDefecto();
  try {
    const colega = señal ? null : await d.esColega(org.id, identidad).catch(() => null);
    const leHablaASofi = SALUDA_A_SOFI.test(String(mensaje.texto || ""));
    if (!señal && !colega && !leHablaASofi) return { resultado: "sin_senal" };

    const desdeIso = new Date(ahora.getTime() - VENTANA_MS).toISOString();
    const estado = await d.estado(org.id, identidad, { desdeIso });
    if (estado.faltaAutor) return { resultado: "falta_autor" };

    const nombreAviso = nombreParaSaludo(mensaje.remitenteNombre, mensaje.texto) || mensaje.remitenteNombre || (colega && colega.nombre) || "Un colega";
    const avisar = async (titulo, cuerpo) => {
      const asesor = await d.asesor(org).catch(() => null);
      if (!asesor) return;
      await d.notificar({ orgId: org.id, advisor: asesor, tipo: "aviso", titulo, cuerpo, link: "/grupos" }).catch(() => {});
    };
    const dijo = `"${recortar(mensaje.texto, 200)}"`;

    if (estado.humano) {
      await avisar(`Respondió un colega: ${nombreAviso}`, `${dijo} · ya lo atiende una persona; Sofi no contesta en este chat.`);
      return { resultado: "humano_atiende" };
    }
    if (estado.respuestasSofi >= MAX_RESPUESTAS) {
      await avisar(`${nombreAviso} sigue escribiendo: te toca`, `Sofi ya le contestó ${MAX_RESPUESTAS} veces por la línea del radar. Último mensaje: ${dijo}`);
      return { resultado: "tope" };
    }

    const codigo = señal ? señal.codigo_colega || (await d.asignarCodigo(org.id, señal.id).catch(() => null)) : null;
    const link = linkOficial(org, codigo);
    const nombre = nombreParaSaludo(mensaje.remitenteNombre, mensaje.texto);
    const refs = señal && Array.isArray(señal.respuesta_refs) ? señal.respuesta_refs.filter(Boolean) : [];
    const fichas = refs.length ? await d.fichas(org, refs).catch(() => []) : [];
    const hilo = estado.hilo && estado.hilo.length ? estado.hilo : [{ direccion: "entrada", texto: mensaje.texto }];
    const usuario = armarUsuario({ numero: estado.respuestasSofi + 1, nombre, señal, fichas, hilo, link, org });

    let texto = await d.redactar({ sistema: SISTEMA, usuario }).catch((e) => {
      console.error("[sofi-linea] No se pudo redactar:", e.message);
      return null;
    });
    const fijo = !texto;
    if (fijo) texto = textoFijo(nombre, link);
    else {
      const limpio = quitarLinksInventados(texto, [usuario]);
      if (limpio.quitados.length) console.warn(`[sofi-linea] Links quitados: ${limpio.quitados.join(", ")}`);
      texto = limpio.texto;
    }

    await d.dormir(PAUSA_MIN_MS + Math.round(d.rand() * PAUSA_RANGO_MS));
    const envio = await d
      .enviar({ sesion: mensaje.sesion, orgId: org.id, telefono: identidad.telefono, lid: identidad.lid, mensajes: [{ texto }] })
      .catch((e) => ({ ok: false, error: e.message }));

    if (!envio || !envio.ok) {
      await avisar(`Respondió un colega: ${nombreAviso}`, `${dijo} · Sofi no le pudo contestar por la línea del radar.`);
      return { resultado: "envio_fallido", error: envio && envio.error };
    }

    await d
      .guardarSalida(org.id, {
        sesion: mensaje.sesion, waMessageId: envio.wamid || `sofi-${ahora.getTime()}`, remitenteTelefono: identidad.telefono,
        remitenteLid: identidad.lid, texto, senalId: señal ? señal.id : null, direccion: "salida", autor: "sofi",
      })
      .catch((e) => console.error("[sofi-linea] No se pudo guardar la salida:", e.message));
    await d.marcarPuente(org.id, identidad).catch(() => 0);
    await avisar(`Respondió un colega: ${nombreAviso}`, `${dijo} · Sofi le contestó (${estado.respuestasSofi + 1} de ${MAX_RESPUESTAS}): "${recortar(texto, 200)}"`);
    return { resultado: fijo ? "respondido_fijo" : "respondido" };
  } catch (e) {
    console.error("[sofi-linea] error:", e.message);
    return { resultado: "error", error: e.message };
  }
}

module.exports = { responder, activo, nombreParaSaludo, linkOficial, textoFijo, redactarConIA, SISTEMA, MAX_RESPUESTAS };
