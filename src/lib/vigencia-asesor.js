// Botones "Sigue disponible" / "Ya no está" de la pregunta de vigencia (spec
// 2026-10-19-sofi-publica-propiedad-asesor §6). El id trae la ref
// (vig:si:D1001), asi que se resuelve sin pasar por el modelo, como los
// botones cita: de cita_por_confirmar.
const advisors = require("../data/advisors");
const datos = require("../data/propiedades-asesor");
const mensajeAsesor = require("./mensaje-asesor");

async function procesarBotonVigencia(org, telefono, botonId) {
  const m = /^vig:(si|no):([A-Za-z0-9]+)$/.exec(String(botonId || ""));
  if (!m) return;
  const advisor = await advisors.findByPhone(org.id, telefono).catch(() => null);
  if (!advisor) return;
  const r = await datos.aplicarVigencia(org.id, advisor.id, m[2], m[1] === "si").catch((e) => {
    console.error("[vigencia-asesor] No se pudo aplicar el boton:", e.message);
    return null;
  });
  if (!r) return;
  const texto =
    r.estado === "no_encontrada" ? `No encuentro la ${r.ref} entre las propiedades que publicaste con Sofi.`
      : r.estado === "renovada" ? `Listo: la ${r.ref} sigue publicada 30 días más.`
        : `Listo: la ${r.ref} sale del inventario y de los grupos.`;
  await mensajeAsesor.enviarYRegistrar(org, telefono, texto).catch(() => null);
}

module.exports = { procesarBotonVigencia };
