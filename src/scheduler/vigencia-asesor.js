// Vigencia de las propiedades que publico Sofi a pedido de un asesor (spec
// 2026-10-19-sofi-publica-propiedad-asesor §6). Cada hora:
// - las vencidas salen del inventario (siempre);
// - de 9 a. m. a 6 p. m., a las que les quedan 5 dias se le pregunta al
//   captador UNA vez si siguen disponibles. Todo aviso va a la campana del
//   CRM (tabla notificaciones), no por WhatsApp (Juan, 2026-10-20); la
//   respuesta se da en "Para atender". SOFI_VIGENCIA_ASESOR=false apaga la
//   pregunta y la propiedad vence igual a los 30 dias.

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
    notificar: (n) => require("../notifications/notificar").notificar(n),
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
    if (!advisor || advisor.activo === false) return;
    await d.notificar({
      orgId: org.id, advisor, tipo: "vigencia_vencida", titulo: `${p.ref} salió del inventario`,
      cuerpo: "Venció a los 30 días. Si sigue disponible, pedile a Sofi que la publique de nuevo.", link: "/pendientes",
    });
  } catch (e) {
    console.warn(`[vigencia-asesor] No salio el aviso de vencimiento de la ${p.ref}: ${e.message}`);
  }
}

async function preguntar(org, p, d, ahora) {
  try {
    const advisor = p.captador_id ? await d.advisor(org, p.captador_id).catch(() => null) : null;
    if (advisor && advisor.activo !== false) {
      await d.notificar({
        orgId: org.id, advisor, tipo: "vigencia_propiedad", titulo: `${p.ref} vence en 5 días`,
        cuerpo: "¿Sigue disponible? Respondé en Para atender.", link: "/pendientes",
      });
    }
  } catch (e) {
    console.warn(`[vigencia-asesor] No salio la pregunta para la ${p.ref}: ${e.message}`);
  }
  // Se marca aunque no haya salido: la propiedad vence igual (spec §6) y no
  // se reintenta cada hora.
  await d.marcarPreguntada(p.id, ahora);
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const d = deps || depsPorDefecto();
  for (const org of await d.orgs()) {
    try {
      for (const p of await d.vencidas(org, ahora)) {
        await d.darDeBaja(p.id);
        console.log(`[vigencia-asesor] ${p.ref} vencio: sale del inventario`);
        const hv = horaBogota(ahora);
        if (hv >= HORA_INICIO && hv < HORA_FIN) await avisarVencida(org, p, d);
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
