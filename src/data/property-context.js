const supabase = require("./supabase");

// Extrae del contexto DCE (property_contexts.context, ver
// db/migrations/2026-07-06_dce_property_contexts.sql) solo lo que Sofi
// necesita para conversar por WhatsApp — no el JSON completo (voice para
// blog/email/facebook/instagram, creative para imagenes, etc. no aplican
// a un chat de texto y engordarian el prompt sin necesidad).
function toSalesContext(context) {
  if (!context) return null;
  const persona = context.audience?.buyerPersonaPrimary;
  return {
    angulo: context.narrative?.storyAngle || null,
    emocionPrincipal: context.emotional?.mainEmotion || null,
    perfilComprador: persona ? `${persona.label} — ${persona.motivacion}` : null,
    beneficiosClave: (context.emotional?.benefits || []).slice(0, 4).map((b) => b.beneficio),
    objecionesResueltas: (context.emotional?.objections || []).map((o) => ({
      objecion: o.objecion,
      respuesta: o.respuesta,
    })),
    tonoWhatsapp: context.voice?.tonePerChannel?.whatsapp || null,
    ctaSugerido: context.narrative?.ctaStyle?.whatsapp || null,
  };
}

// Contexto de venta (DCE) de UNA propiedad, ya resumido para el chat.
// null si no hay Supabase, si la propiedad no tiene contexto, o si aun no
// esta listo (status distinto de 'ready') — Sofi sigue funcionando igual
// con los datos crudos de properties, esto es un complemento, no una
// dependencia dura.
async function getSalesContext(orgId, propertyId) {
  if (!supabase || !propertyId) return null;
  const { data, error } = await supabase
    .from("property_contexts")
    .select("status, context")
    .eq("org_id", orgId)
    .eq("property_id", propertyId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) {
    console.warn("[property-context] No se pudo consultar el DCE:", error.message);
    return null;
  }
  return data ? toSalesContext(data.context) : null;
}

module.exports = { getSalesContext, toSalesContext };
