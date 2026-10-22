// Puente colega -> Sofi (Juan, 2026-10-17, opcion B).
//
// La linea del radar (hoy la de Daiana) manda los DM a los colegas, pero no
// conversa: es una linea vinculada por WAHA y un bot hablando por ahi es el
// riesgo que costo un baneo en julio (ver sofi-grupos-whatsapp en la
// memoria). Hasta hoy, si el colega respondia, el mensaje quedaba guardado en
// linea_dm y nadie lo leia. Caso real: Isabel Restrepo pregunto "cuales
// tienen 2 alcobas con baño" a las 7:41 p. m. y paso la noche sin respuesta.
//
// Ahora, a la PRIMERA respuesta de un colega a un DM del radar:
//   1. sale UN mensaje por la misma linea con el link a Sofi, que trae el
//      codigo del pedido y la pregunta del colega ya escritos — Sofi reconoce
//      el codigo (codigo-colega.js#reconocer), sabe que fichas se le
//      mandaron (prompts.js#promptColega) y agenda con la rotacion;
//   2. queda un aviso en la app para la asesora del radar.
// Nada mas sale por esa linea: si el colega sigue escribiendo, no se repite.
//
// Interruptor: RADAR_PUENTE_SOFI=false apaga el carril entero.

const { linkContactoOficial } = require("../lib/contacto");
const { primerNombre } = require("./redactar");

const VALORES_APAGADO = new Set(["false", "0", "no", "off"]);
const MAX_PREGUNTA = 300;
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
// "Hola Sofi", "hola sofy", "Sofi buenas": un mensaje que LE HABLA a Sofi.
// Anclado al comienzo a proposito: los resumenes que Sofi le manda a Daiana
// la NOMBRAN en el medio ("lo que Sofi hace sola") y no deben disparar nada.
const SALUDA_A_SOFI = /^\s*(?:hola|buen[oa]s?(?:\s+(?:d[ií]as|tardes|noches))?|hey|ola)?[\s,!.]*sof(?:[iyí]|[ií]a)\b/i;

function activo() {
  return !VALORES_APAGADO.has(String(process.env.RADAR_PUENTE_SOFI ?? "").trim().toLowerCase());
}

function depsPorDefecto() {
  return {
    historial: (orgId, identidad) => require("../data/linea-dm").historialDe(orgId, identidad, { limite: 10 }),
    asignarCodigo: (orgId, signalId) => require("./codigo-colega").asignarCodigo(orgId, signalId),
    enviar: (args) => require("./envio-colega").enviarAlColega(args),
    asesor: (org) => require("../data/advisors").findAsesorPrincipalRadar(org),
    notificar: (args) => require("../notifications/notificar").notificar(args),
    // Esta en nuestros grupos? colegas_grupos guarda el lid en digitos.
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
  };
}

function recortar(texto, max) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

function textoPuente(nombre, link) {
  const saludo = primerNombre(nombre) ? `¡Hola ${primerNombre(nombre)}!` : "¡Hola!";
  return `${saludo} Para responderte más rápido te paso con Sofi, nuestra asistente: ella tiene tu pedido y las fichas, y te agenda la visita con un asesor 👉 ${link}`;
}

/**
 * @returns {{ resultado: "apagado"|"sin_senal"|"ya_tendido"|"sin_codigo"|"sin_link"|"tendido"|"envio_fallido", error? }}
 */
async function tenderPuente(org, { mensaje, señal, identidad, dmId }, deps = null) {
  if (!activo()) return { resultado: "apagado" };
  if (!org) return { resultado: "sin_senal" };
  const d = deps || depsPorDefecto();

  // SIN PEDIDO LIGADO (Juan, 2026-10-17: "puente a Sofi tambien"). Caso:
  // Avitárea pidio "los de 2 y 3 habitaciones" el 5-oct y nadie le contesto.
  // Solo si quien escribe esta en nuestros grupos: a Wasi cobrando o a una
  // empresa de carros no se les contesta desde la linea.
  const colega = señal || !d.esColega ? null : await d.esColega(org.id, identidad).catch(() => null);
  // Caso Catherine Uribe (2026-10-17): "Hola sofy" a la linea del radar,
  // sin ser colega de los grupos. Si le habla a Sofi, tambien va el puente.
  const leHablaASofi = SALUDA_A_SOFI.test(String(mensaje.texto || ""));
  if (!señal && !colega && !leHablaASofi) return { resultado: "sin_senal" };

  const historial = await d.historial(org.id, identidad).catch(() => []);
  const otros = historial.filter((m) => m.id !== dmId);
  if (señal && otros.some((m) => m.senal_id === señal.id)) return { resultado: "ya_tendido" };
  if (!señal && otros.some((m) => Date.now() - new Date(m.created_at).getTime() < SEMANA_MS)) return { resultado: "ya_tendido" };

  const codigo = señal ? señal.codigo_colega || (await d.asignarCodigo(org.id, señal.id).catch(() => null)) : null;
  if (señal && !codigo) return { resultado: "sin_codigo" };

  const pregunta = recortar(mensaje.texto, MAX_PREGUNTA);
  const encabezado = codigo ? `Hola Sofi, sobre mi PEDIDO (cód. ${codigo})` : colega ? "Hola Sofi, soy colega inmobiliario" : "Hola Sofi";
  const link = linkContactoOficial(org, `${encabezado}${pregunta ? `: ${pregunta}` : ""}`);
  if (!link) return { resultado: "sin_link" };

  const nombre = mensaje.remitenteNombre || (señal && señal.autor_nombre) || (colega && colega.nombre) || "Un colega";
  const envio = await d
    .enviar({ sesion: mensaje.sesion, orgId: org.id, telefono: identidad.telefono, lid: identidad.lid, mensajes: [{ texto: textoPuente(nombre, link) }] })
    .catch((e) => ({ ok: false, error: e.message }));

  const asesor = await d.asesor(org).catch(() => null);
  if (asesor) {
    await d
      .notificar({
        orgId: org.id,
        advisor: asesor,
        tipo: "aviso",
        titulo: `Respondió un colega: ${nombre}`,
        cuerpo: `"${recortar(mensaje.texto, 200)}" · ${envio && envio.ok ? "le pasamos el link a Sofi" : "no se le pudo mandar el link a Sofi"}${codigo ? ` (cód. ${codigo})` : " (sin pedido ligado)"}`,
        link: "/grupos",
      })
      .catch(() => {});
  }

  if (!envio || !envio.ok) return { resultado: "envio_fallido", error: envio && envio.error };
  // Las respuestas a publicaciones de este colega ya tienen su link a Sofi: el recordatorio de las 3 h no insiste.
  await require("../data/respuestas-publicacion").marcarPuente(org.id, identidad).catch(() => 0);
  return { resultado: "tendido" };
}

module.exports = { tenderPuente, activo, textoPuente, SALUDA_A_SOFI };
