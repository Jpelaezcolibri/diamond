// Vigencia de las propiedades que publico Sofi a pedido de un asesor (spec
// 2026-10-19-sofi-publica-propiedad-asesor §6). Cada hora:
// - las vencidas salen del inventario (siempre);
// - de 9 a. m. a 6 p. m., a las que les quedan 5 dias se le pregunta al
//   captador UNA vez si siguen disponibles. Excepcion explicita a
//   ASESORA_SOLO_VISITAS (Juan, 2026-10-19); SOFI_VIGENCIA_ASESOR=false la
//   apaga y la propiedad vence igual a los 30 dias.
const { VENTANA_CERRADA } = require("../lib/mensaje-asesor");

const BOGOTA_UTC = 5;
const HORA_INICIO = 9;
const HORA_FIN = 18;

function preguntaActiva() {
  return String(process.env.SOFI_VIGENCIA_ASESOR ?? "").trim().toLowerCase() !== "false";
}

function horaBogota(ahora) {
  return new Date(ahora.getTime() - BOGOTA_UTC * 3600e3).getUTCHours();
}

function depsPorDefecto() {
  const datos = require("../data/propiedades-asesor");
  return {
    orgs: () => require("../data/organizations").listActive(),
    porPreguntar: (org, ahora) => datos.porPreguntar(org.id, ahora),
    vencidas: (org, ahora) => datos.vencidas(org.id, ahora),
    advisor: (org, id) => require("../data/advisors").findById(org.id, id),
    enviarTexto: (org, tel, texto, opts) => require("../lib/mensaje-asesor").enviarYRegistrar(org, tel, texto, opts),
    enviarPlantilla: (org, tel, p) => require("../channels/whatsapp").sendWhatsAppTemplate(org, tel, p),
    marcarPreguntada: (id, ahora) => datos.marcarPreguntada(id, ahora),
    darDeBaja: (id) => datos.darDeBaja(id),
  };
}

let avisoMigracionDia = null;

function esColumnaFaltante(e) {
  return Boolean(e) && (e.code === "42703" || e.code === "PGRST204" || /origen|vence_at|vigencia_preguntada_at/.test(String(e.message || "")));
}

// Aviso best-effort al captador cuando su propiedad sale por vencimiento.
async function avisarVencida(org, p, d) {
  try {
    const advisor = p.captador_id ? await d.advisor(org, p.captador_id) : null;
    if (!advisor || !advisor.phone || advisor.activo === false) return;
    const r = await d.enviarTexto(org, advisor.phone, `Tu ${p.ref} salió del inventario: venció a los 30 días. Si sigue disponible, pedime publicarla de nuevo.`);
    if (r && r.ok === false) console.warn(`[vigencia-asesor] No salio el aviso de vencimiento de la ${p.ref}: ${r.error}`);
  } catch (e) {
    console.warn(`[vigencia-asesor] No salio el aviso de vencimiento de la ${p.ref}: ${e.message}`);
  }
}

async function preguntar(org, p, d, ahora) {
  const advisor = p.captador_id ? await d.advisor(org, p.captador_id).catch(() => null) : null;
  if (advisor && advisor.phone && advisor.activo !== false) {
    const texto = `Hola ${String(advisor.name || "").split(" ")[0]}, tu ${p.ref} (${p.titulo || "propiedad"}) vence en 5 días en nuestro inventario. ¿Sigue disponible?`;
    const botones = [{ id: `vig:si:${p.ref}`, title: "Sigue disponible" }, { id: `vig:no:${p.ref}`, title: "Ya no está" }];
    const r = await d.enviarTexto(org, advisor.phone, texto, { botones }).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok && VENTANA_CERRADA.test(String(r.error || ""))) {
      const t = await d.enviarPlantilla(org, advisor.phone, {
        name: "vigencia_propiedad", bodyParams: [p.ref, String(p.titulo || "tu propiedad").replace(/\s+/g, " ").trim().slice(0, 60)], buttonPayloads: botones.map((b) => b.id),
      }).catch((e) => ({ ok: false, error: e.message }));
      if (!t || !t.ok) console.warn(`[vigencia-asesor] No salio la plantilla para la ${p.ref}: ${t && t.error}`);
    } else if (!r.ok) {
      console.warn(`[vigencia-asesor] No salio la pregunta para la ${p.ref}: ${r.error}`);
    }
  }
  // Se marca aunque no haya salido: la propiedad vence igual (spec §6) y no
  // se reintenta cada hora contra una plantilla sin aprobar.
  await d.marcarPreguntada(p.id, ahora);
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const d = deps || depsPorDefecto();
  for (const org of await d.orgs()) {
    try {
      for (const p of await d.vencidas(org, ahora)) {
        await d.darDeBaja(p.id);
        console.log(`[vigencia-asesor] ${p.ref} vencio: sale del inventario`);
        await avisarVencida(org, p, d);
      }
      const h = horaBogota(ahora);
      if (!preguntaActiva() || h < HORA_INICIO || h >= HORA_FIN) continue;
      for (const p of await d.porPreguntar(org, ahora)) await preguntar(org, p, d, ahora);
    } catch (e) {
      if (esColumnaFaltante(e)) {
        const dia = new Date(ahora.getTime() - BOGOTA_UTC * 3600e3).toISOString().slice(0, 10);
        if (avisoMigracionDia !== dia) {
          avisoMigracionDia = dia;
          console.warn("[vigencia-asesor] Falta correr 2026-10-19_propiedades_asesor.sql: no hay vigencia todavia.");
        }
        continue;
      }
      console.error("[vigencia-asesor] error en", org.name, e.message);
    }
  }
}

function start() {
  const tick = () => runOnce().catch((e) => console.error("[vigencia-asesor] runOnce:", e.message));
  setTimeout(tick, 3 * 60 * 1000);
  setInterval(tick, 60 * 60 * 1000);
  console.log(`[vigencia-asesor] activo — pregunta ${preguntaActiva() ? "prendida" : "apagada"} (SOFI_VIGENCIA_ASESOR)`);
}

function _reset() {
  avisoMigracionDia = null;
}

module.exports = { runOnce, start, _reset };
