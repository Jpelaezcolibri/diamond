// Herramientas con las que Sofi publica la propiedad de un asesor (spec
// docs/superpowers/specs/2026-10-19-sofi-publica-propiedad-asesor-design.md
// §2 y §6). Nunca publican en un grupo: crean la propiedad y el publicador
// la saca con su freno.
const { normalizar, tokenDe } = require("../lib/propiedad-asesor");
const datos = require("../data/propiedades-asesor");
const { postGrupo } = require("../groups/redactar");
const { textoPost } = require("../groups/publicador");

const SOLO_ASESOR = "Esta herramienta es solo para un asesor de la casa. No la vuelvas a usar en esta conversación; si es un dueño que quiere arrendar o vender, seguí con registrar_inmueble_ofrecido.";

function noEsAsesor(ctx) {
  return !ctx.advisor || ctx.advisor.activo === false;
}
const APAGADO = "La publicación de propiedades por Sofi no está activa todavía. Dile al asesor que la cargue en Wasi o que hable con Juan.";

function activo() {
  return process.env.SOFI_PUBLICA_ASESOR === "true";
}

async function revisar(input, ctx) {
  const { token, excluir_fotos: excluir, ...resto } = input || {};
  const { fila, faltantes } = normalizar(resto);
  // Solo las fotos de ESTA propiedad: desde que se creo la anterior del captador.
  const desde = await datos.ultimaCreadaPor(ctx.org.id, ctx.advisor.id).catch(() => null);
  let fotos = ctx.conversationId ? await datos.fotosRecientes(ctx.conversationId, { desde }).catch(() => []) : [];
  const fuera = new Set((Array.isArray(excluir) ? excluir : []).map(Number));
  fotos = fotos.filter((_, i) => !fuera.has(i + 1));
  if (fotos.length === 0) faltantes.push("al menos una foto (que te la mande por este chat)");
  return { token, fila, fotos, faltantes };
}

function mensajeFaltantes(faltantes, fotos) {
  return `FALTAN DATOS, pídeselos al asesor (no inventes ninguno): ${faltantes.join("; ")}.${fotos.length ? ` Ya tengo ${fotos.length} foto(s).` : ""}`;
}

async function preparar(input, ctx) {
  if (noEsAsesor(ctx)) return SOLO_ASESOR;
  if (!activo()) return APAGADO;
  const { fila, fotos, faltantes } = await revisar(input, ctx);
  if (faltantes.length) return mensajeFaltantes(faltantes, fotos);
  const cuerpo = postGrupo({ ...fila, ref: "nueva", linkWasi: "(link de la ficha, se crea al confirmar)" }, { org: ctx.org });
  const post = textoPost({ id: "preview", publica: "ofertas" }, fila, cuerpo);
  const lista = fotos.map((_, i) => `Foto ${i + 1}`).join(", ");
  return `VISTA PREVIA (muéstrasela tal cual y pide un sí explícito antes de confirmar). Fotos recibidas: ${fotos.length} (${lista}); si alguna no es de esta propiedad, que te diga el número y vuelve a llamar preparar_publicacion con excluir_fotos. token=${tokenDe(fila, fotos)}\n\n${post}`;
}

async function confirmar(input, ctx) {
  if (noEsAsesor(ctx)) return SOLO_ASESOR;
  if (!activo()) return APAGADO;
  const { token, fila, fotos, faltantes } = await revisar(input, ctx);
  if (faltantes.length) return mensajeFaltantes(faltantes, fotos);
  if (tokenDe(fila, fotos) !== token) {
    return "Los datos o las fotos cambiaron desde la vista previa: vuelve a llamar preparar_publicacion y muéstrale la vista previa nueva.";
  }
  try {
    const p = await datos.crear(ctx.org, ctx.advisor, fila, fotos);
    // Calienta la cache de la landing sin bloquear: el publicador no debe encontrar la ficha fria.
    if (p.link && typeof fetch === "function") fetch(p.link, { signal: AbortSignal.timeout(8000) }).catch(() => {});
    return `${p.ya_existia ? "YA ESTABA CREADA" : "CREADA"}: ref ${p.ref}, ficha ${p.link}. Dile al asesor la ref y el link: la ficha queda visible en unos minutos y sale en los grupos en los próximos turnos (lunes a sábado, 8 a. m. a 6 p. m.). Vence en 30 días; a los 25 le pregunto si sigue disponible.`;
  } catch (e) {
    console.error("[publicar-asesor] No se pudo crear la propiedad:", e.message);
    if (e.code === "SIN_MIGRACION") return "No se pudo crear: falta correr la migración de propiedades de asesor. Díselo al asesor y no prometas que se publicó.";
    return "No se pudo crear la propiedad por un error técnico. Díselo al asesor y no prometas que se publicó.";
  }
}

async function actualizarVigencia(input, ctx) {
  if (noEsAsesor(ctx)) return SOLO_ASESOR;
  try {
    const r = await datos.aplicarVigencia(ctx.org.id, ctx.advisor.id, input && input.ref, Boolean(input && input.sigue));
    if (r.estado === "no_encontrada") return `No encuentro la ${r.ref} entre las propiedades que publicaste con Sofi.`;
    if (r.estado === "renovada") return `Listo: la ${r.ref} sigue publicada 30 días más.`;
    return `Listo: la ${r.ref} sale del inventario y de los grupos.`;
  } catch (e) {
    console.error("[publicar-asesor] No se pudo actualizar la vigencia:", e.message);
    return "No pude actualizarla por un error técnico. Díselo al asesor.";
  }
}

module.exports = { preparar, confirmar, actualizarVigencia, activo };
