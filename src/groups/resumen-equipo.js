// El resumen de matches pendientes que se le manda a un asesor, armado del
// dato real — no redactado por el modelo.
//
// POR QUE EXISTE. Juan pidio que el mensaje a Catherine cite lo que el colega
// escribio, muestre las propiedades que sirven, y lleve un link de contacto
// bien validado. Dejar que Sofi redacte eso libre (enviar_whatsapp_equipo)
// ya fallo una vez en produccion (2026-08-18): armo un link inventado
// ("wa.me/message/YOUR_CONTACT_LINK") en vez de decir que no tenia el
// telefono. Con esto, el modelo elige A QUIEN se le manda; el CONTENIDO sale
// siempre de trazabilidad_radar (mismo dato validado que usa alerta-asesor.js
// para el aviso automatico), asi que no hay nada que inventar.

const { tocarNombreEnGrupo } = require("../lib/contacto");

function bloque(s) {
  const utiles = (s.motor?.detalle || []).filter((m) => (s.sofi?.refs || []).map(String).includes(String(m.ref)));
  const lineas = utiles
    .map((m) => `  ▸ Ref ${m.ref}${m.zona ? ` — ${m.zona}` : ""}${m.precio ? ` · ${m.precio}` : ""}`)
    .join("\n");
  // Nunca "respondele en el grupo" (norma de Juan, 2026-08-22): sin telefono
  // resuelto, la accion real es tocar el nombre del colega en el grupo para
  // abrirle el chat privado. tocarNombreEnGrupo vive en src/lib/contacto.js.
  const contactoTexto = s.contacto_wa || `sin teléfono — ${tocarNombreEnGrupo(s.colega)}`;
  return [
    `${s.colega} (grupo ${s.grupo}):`,
    `Pidió: "${s.pidio}"`,
    lineas || null,
    `Contacto: ${contactoTexto}`,
  ].filter((l) => l !== null).join("\n");
}

// @param señales  filas de trazabilidad_radar (radar-trazabilidad.js) ya
//                 filtradas por quien llama: aprobadas por Sofi, sin
//                 resultado todavia, del asesor que corresponda.
function construir(señales) {
  const conMatch = (señales || []).filter((s) => s.sofi && s.sofi.aprobo && (s.sofi.refs || []).length);
  if (conMatch.length === 0) return null;

  const bloques = conMatch.map(bloque);
  const plural = bloques.length > 1;

  return [
    `Match${plural ? "es" : ""} pendiente${plural ? "s" : ""} de seguimiento:`,
    "",
    bloques.join("\n\n"),
    "",
    "Contame en qué quedó cada uno para registrarlo.",
  ].join("\n");
}

module.exports = { construir };
