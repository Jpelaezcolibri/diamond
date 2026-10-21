// Recordatorios de respuestas a publicaciones (spec 2026-10-20 §4): Daiana por
// la campana a las 2 h, link a Sofi al colega a las 3 h y seguimiento a las 24 h
// de su ultimo mensaje. RADAR_RESPUESTAS_POST=true lo enciende.
const { primerNombre } = require("../groups/redactar");
const SOLO_LLAMADA = "colega_solo_llamada"; // error de waha.enviarDm cuando el colega pidio solo llamada

const H = 3600e3;
const TOPE_DIA = 20;
const CUOTA_MAX = 0.8;
const BOGOTA_UTC = 5;

function activo() {
  return String(process.env.RADAR_RESPUESTAS_POST || "").trim().toLowerCase() === "true";
}

function enHorario(ahora) {
  const b = new Date(ahora.getTime() - BOGOTA_UTC * H);
  const h = b.getUTCHours();
  return b.getUTCDay() !== 0 && h >= 8 && h < 19;
}

function decidir(f, ahora) {
  const desde = (iso) => ahora.getTime() - new Date(iso).getTime();
  const enviados = (f.puente_at ? 1 : 0) + (f.seguimiento_at ? 1 : 0);
  if (!f.atendida_at) {
    if (!f.recordatorio_at && desde(f.primer_at) >= 2 * H) return "daiana";
    if (!f.puente_at && desde(f.primer_at) >= 3 * H && enviados < 2) return "puente";
  }
  const hubo = f.atendida_at || f.puente_at;
  if (hubo && !f.seguimiento_at && enviados < 2 && desde(f.ultimo_entrante_at) >= 24 * H) return "seguimiento";
  return null;
}

function saludo(f) {
  const n = primerNombre(f.colega_nombre);
  return n ? `Hola ${n},` : "Hola,";
}
function textoPuente(f, link) {
  return `${saludo(f)} gracias por escribir por la Ref ${f.property_ref} 🙌 Para responderte ya y agendar la visita, te atiende Sofi aquí: ${link}`;
}
function textoSeguimiento(f, link) {
  return `${saludo(f)} ¿tu cliente alcanzó a ver la Ref ${f.property_ref}? Si quiere visitarla, la agendamos con Sofi: ${link}`;
}

function depsPorDefecto() {
  const datos = require("../data/respuestas-publicacion");
  const sb = () => require("../data/supabase");
  return {
    orgs: () => require("../data/organizations").listActive(),
    abiertas: (org) => sinAtenderOSeguimiento(org.id),
    asesora: (org, sesion) => require("../groups/visita-linea").asesoraDeLinea(org, sesion),
    sesion: async (org) => {
      const s = await require("../data/whatsapp-groups").listSessions(org.id);
      const a = (s || []).filter((x) => x.estado === "activa");
      return a.length === 1 ? a[0].nombre : null;
    },
    cuota: (sesion) => require("../lib/waha").cuotaDeLinea(sesion),
    enviadosHoy: async (org, ahora) => {
      const b = new Date(ahora.getTime() - BOGOTA_UTC * H);
      const inicio = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), BOGOTA_UTC)).toISOString();
      const { count: c1 } = await sb().from("respuestas_publicacion").select("id", { count: "exact", head: true }).eq("org_id", org.id).gte("puente_at", inicio);
      const { count: c2 } = await sb().from("respuestas_publicacion").select("id", { count: "exact", head: true }).eq("org_id", org.id).gte("seguimiento_at", inicio);
      return (c1 || 0) + (c2 || 0);
    },
    // ¿puente-sofi ya le mando el link a este colega en 24 h? Se mira linea_dm:
    // el puente se tiende a la primera respuesta ligada a un pedido.
    puenteReciente: async () => false,
    notificar: (n) => require("../notifications/notificar").notificar(n),
    enviarDm: (s, tel, texto, opts) => require("../lib/waha").enviarDm(s, tel, texto, opts),
    marcar: (id, patch) => datos.marcar(id, patch),
    link: (org, f) => require("../lib/contacto").linkContactoOficial(org, `Hola Sofi, vi en un grupo la Ref ${f.property_ref}`),
  };
}

// Abiertas (para Daiana y puente) y atendidas sin seguimiento (para las 24 h).
async function sinAtenderOSeguimiento(orgId) {
  const { data, error } = await require("../data/supabase").from("respuestas_publicacion").select("*")
    .eq("org_id", orgId).in("via", ["linea", "grupo"]).is("seguimiento_at", null).limit(500);
  if (error) throw error;
  return data || [];
}

async function sinAtender(orgId, ahora = new Date()) {
  const corte = new Date(ahora.getTime() - 2 * H).toISOString();
  const { data, error } = await require("../data/supabase").from("respuestas_publicacion").select("property_ref, colega_nombre, via, primer_at, primer_texto")
    .eq("org_id", orgId).in("via", ["linea", "grupo"]).is("atendida_at", null).lte("primer_at", corte).order("primer_at").limit(20);
  if (error) throw error;
  return data || [];
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  if (!activo() || !enHorario(ahora)) return;
  const d = deps || depsPorDefecto();
  for (const org of await d.orgs()) {
    try {
      const sesion = await d.sesion(org);
      const asesora = await d.asesora(org, sesion).catch(() => null);
      let enviados = await d.enviadosHoy(org, ahora).catch(() => TOPE_DIA);
      for (const f of await d.abiertas(org)) {
        const accion = decidir(f, ahora);
        if (!accion) continue;
        const marca = new Date(ahora).toISOString();
        if (accion === "daiana") {
          if (!asesora) continue;
          await d.notificar({ orgId: org.id, advisor: asesora, tipo: "respuesta_sin_atender",
            titulo: `⏰ Un colega espera respuesta (Ref ${f.property_ref})`,
            cuerpo: `${f.colega_nombre || "Un colega"} escribió hace más de 2 h y nadie le ha respondido.`, link: "/publicaciones" }).catch(() => null);
          await d.marcar(f.id, { recordatorio_at: marca });
          continue;
        }
        if (!sesion || enviados >= TOPE_DIA) continue;
        const cuota = await d.cuota(sesion).catch(() => null);
        if (!cuota || !(cuota.fraccion < CUOTA_MAX)) continue;
        if (accion === "puente" && (await d.puenteReciente(org, f).catch(() => true))) {
          await d.marcar(f.id, { puente_at: marca });
          continue;
        }
        const link = d.link(org, f);
        const texto = accion === "puente" ? textoPuente(f, link) : textoSeguimiento(f, link);
        const r = await d.enviarDm(sesion, f.colega_telefono || null, texto, { ...(f.colega_lid ? { lid: f.colega_lid } : {}), orgId: org.id }).catch((e) => ({ ok: false, error: e.message }));
        const campo = accion === "puente" ? "puente_at" : "seguimiento_at";
        // Solo llamada o enviado: se marca para no insistir. Un fallo de red, no.
        if ((r && r.ok) || (r && r.error === SOLO_LLAMADA)) await d.marcar(f.id, { [campo]: marca });
        if (r && r.ok) enviados++;
      }
    } catch (e) {
      console.error("[respuestas-publicacion] error en", org.name, e.message);
    }
  }
}

function start() {
  const tick = () => runOnce().catch((e) => console.error("[respuestas-publicacion] runOnce:", e.message));
  setTimeout(tick, 4 * 60 * 1000);
  setInterval(tick, 15 * 60 * 1000);
  console.log(`[respuestas-publicacion] ${activo() ? "PRENDIDO" : "apagado"} (RADAR_RESPUESTAS_POST)`);
}

module.exports = { decidir, textoPuente, textoSeguimiento, runOnce, start, sinAtender, activo };
