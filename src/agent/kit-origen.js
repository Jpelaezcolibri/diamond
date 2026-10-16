// El texto prellenado del link a Sofi que va en cada post del kit de
// publicacion (src/groups/redactar.js#postGrupo): "Hola, vi en un grupo la
// Ref N". Si un lead llega con esa frase, el negocio vino de un post en un
// grupo (spec 2026-10-16, §3.5). Mismo formato de ref que REF_PATTERN de
// engine.js.
const KIT_RE = /\bvi en un grupo la ref\s+([A-Z]{2}\d{3}|\d{6,8})\b/i;

function refDeKit(text) {
  const m = String(text || "").match(KIT_RE);
  return m ? m[1].toUpperCase() : null;
}

module.exports = { refDeKit, KIT_RE };
