// Atribucion de respuestas de colegas a nuestras publicaciones en grupos
// (spec 2026-10-20-publicaciones-y-respuestas §2-3). Nunca lanza: devuelve
// null y deja rastro en el log.
const datos = require("../data/respuestas-publicacion");
const { refDeKit } = require("../agent/kit-origen");

// Ref de Wasi (6 a 8 digitos) o de asesor (D + 4 o mas). Un celular
// colombiano (10 digitos que empiezan por 3) no es ref.
const REF_RE = /\b(D\d{4,}|\d{6,8})\b/i;

function refDeTexto(texto) {
  const m = REF_RE.exec(String(texto || ""));
  return m ? m[1].toUpperCase() : null;
}

async function seguro(etiqueta, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[respuestas-publicacion] ${etiqueta}:`, e.message);
    return null;
  }
}

async function deLinea(org, { texto, senalId = null, identidad = {}, nombre = null }) {
  return seguro("linea", async () => {
    const lid = identidad.lid || null;
    const telefono = identidad.telefono || null;
    let post = null;
    const ref = refDeTexto(texto);
    if (ref) post = await datos.postReciente(org.id, ref);
    if (!post && !senalId) {
      const grupos = await datos.colegaGrupos(org.id, { lid, telefono });
      const posts = await datos.postsEnGrupos(org.id, grupos);
      post = posts[0] || null;
    }
    if (!post) return null;
    const r = await datos.registrar(org.id, {
      ref: post.property_ref, publicacionId: post.id, groupId: post.group_id, via: "linea", lid, telefono, nombre, texto,
    });
    return { ...r, ref: post.property_ref, via: "linea" };
  });
}

async function deSofi(org, { texto, telefono, nombre = null, leadId = null }) {
  return seguro("sofi", async () => {
    const ref = refDeKit(texto);
    if (!ref) return null;
    const post = await datos.postReciente(org.id, ref);
    if (!post) return null;
    const r = await datos.registrar(org.id, {
      ref, publicacionId: post.id, groupId: post.group_id, via: "sofi", telefono, nombre, texto, leadId, atendida: true,
    });
    return { ...r, ref, via: "sofi" };
  });
}

async function deGrupo(org, { replyToId, autorId, nombre = null, texto }) {
  if (!replyToId || !autorId) return null;
  return seguro("grupo", async () => {
    const post = await datos.postPorWamid(org.id, replyToId);
    if (!post) return null;
    const esLid = String(autorId).endsWith("@lid");
    const r = await datos.registrar(org.id, {
      ref: post.property_ref, publicacionId: post.id, groupId: post.group_id, via: "grupo",
      lid: esLid ? autorId : null, telefono: esLid ? null : String(autorId).replace(/\D/g, ""), nombre, texto,
    });
    return { ...r, ref: post.property_ref, via: "grupo" };
  });
}

async function atendidaPorLinea(org, identidad) {
  return (await seguro("atendida", () => datos.marcarAtendidas(org.id, identidad, "linea"))) || 0;
}

module.exports = { refDeTexto, deLinea, deSofi, deGrupo, atendidaPorLinea };
