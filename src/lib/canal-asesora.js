// La asesora tocó "Estoy disponible" en la plantilla abrir_canal_asesora
// (scheduler/abrir-canal-asesoras.js). Ese toque ya abrió la ventana de 24 h
// en Meta; acá se deja como mensaje entrante en su chat con Sofi (es lo que
// mira ventana-asesoras.ventanaAbierta) y se le contesta corto, sin pasar por
// Claude.
const TEXTO_RESPUESTA = "¡Gracias! Quedó abierto el canal: hoy te llegan por aquí las visitas por confirmar y los casos de colegas.";

function depsPorDefecto() {
  return {
    lead: (orgId, tel) => require("../data/leads").findOrCreate(orgId, tel, "asesor"),
    conv: (orgId, leadId) => require("../data/conversations").findOrCreate(orgId, leadId, null),
    guardar: (...a) => require("../data/conversations").appendMessage(...a),
    enviar: (...a) => require("../channels/whatsapp").sendWhatsApp(...a),
  };
}

async function procesarBotonCanal(org, telefono, deps = null) {
  const d = deps ? { ...depsPorDefecto(), ...deps } : depsPorDefecto();
  try {
    const lead = await d.lead(org.id, telefono);
    const conv = await d.conv(org.id, lead.id);
    await d.guardar(conv.id, "user", "Estoy disponible");
    const r = await Promise.resolve(d.enviar(org, telefono, TEXTO_RESPUESTA)).catch((e) => ({ ok: false, error: e.message }));
    await Promise.resolve(d.guardar(conv.id, "assistant", TEXTO_RESPUESTA, { wa_message_id: (r && r.wamid) || null })).catch(() => {});
    console.log(`[canal-asesora] ${telefono.slice(-4)}: canal abierto${r && r.ok ? "" : " (la respuesta no salió)"}`);
    return { ok: true };
  } catch (e) {
    console.error("[canal-asesora] error:", e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { procesarBotonCanal, TEXTO_RESPUESTA };
