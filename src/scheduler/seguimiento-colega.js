// Seguimiento al colega (Juan, 2026-10-07; spec 2026-10-07-sofi-vendedora-y-agenda §5.3).
//
// 1) +4 h DEL DM DEL RADAR. Si el colega no toco ningun link a Sofi
//    (colega_escribio_at) ni respondio por la linea, UN solo seguimiento por
//    pedido:
//    - con telefono: plantilla `seguimiento_colega` por la linea OFICIAL (si
//      responde, le cae directo a Sofi y no gasta la cuota de la linea);
//    - con solo lid: un texto por la linea de GRUPOS con el link a Sofi y el
//      codigo, con tope diario (RADAR_SEGUIMIENTO_TOPE_DIA) y frenado si la
//      cuota de WhatsApp va en 80 %. La cuota no cuenta los envios por lid
//      (memoria cuota-whatsapp-no-cuadra-con-la-base): el tope es la proteccion
//      real de la linea.
// 2) +24 h EN LA LINEA OFICIAL. Al colega que le escribio a Sofi, ya recibio
//    el seguimiento de las 3 h (followups.js) y sigue callado: la plantilla
//    `seguimiento_colega`, y ahi para.
//
// Nada de 20:00 a 08:00. Interruptores: RADAR_SEGUIMIENTO_DM y
// SOFI_SEGUIMIENTO_COLEGA (default encendidos).
const supabase = require("../data/supabase");
const reglas = require("../lib/agenda-reglas");
const { linkContactoOficial } = require("../lib/contacto");

const INTERVALO_MIN = Number(process.env.SEGUIMIENTO_COLEGA_INTERVALO_MIN || 15);
const TOPE_DIA = Number(process.env.RADAR_SEGUIMIENTO_TOPE_DIA || 30);
const HORA = 60 * 60 * 1000;

const primerNombre = (n) => String(n || "").trim().split(/\s+/)[0] || "";

function pedidoCorto(senal) {
  const que = senal.tipo || "inmueble";
  return senal.zona ? `${que} en ${senal.zona}` : que;
}

// Por donde (y si) sale el seguimiento de un DM. Pura.
function decidirSeguimientoDm({ respondio, soloLlamada, telefono, topeOk, cuotaOk }) {
  if (respondio) return "no_hizo_falta";
  if (soloLlamada !== false) return "solo_llamada";
  if (telefono) return "plantilla";
  if (!topeOk) return "tope";
  if (!cuotaOk) return "cuota";
  return "linea_grupos";
}

function textoLineaGrupos(senal, org) {
  const nombre = primerNombre(senal.autor_nombre);
  const link = senal.codigo_colega
    ? linkContactoOficial(org, `Hola Sofi, quiero más opciones para mi PEDIDO (cód. ${senal.codigo_colega})`)
    : linkContactoOficial(org);
  return [
    `Hola${nombre ? ` ${nombre}` : ""}, ¿te sirvió alguna de las opciones que te mandé?`,
    link ? `Si querés más opciones o tenés alguna duda, escribile a Sofi 👉 ${link}` : "Si querés más opciones o tenés alguna duda, contame.",
    "— Sofi, asistente virtual",
  ].join("\n");
}

// ── Acceso a datos por defecto (los tests inyectan los suyos) ─────────────
function depsPorDefecto() {
  return {
    org: () => require("../data/organizations").getDefault(),
    listar: async (ahora) => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("group_signals")
        .select("id, org_id, autor_nombre, respuesta_destino_lid, respuesta_destino_telefono, respondida_at, codigo_colega, tipo, zona")
        .eq("respuesta_modo", "auto")
        .is("seguimiento_dm_at", null)
        .is("colega_escribio_at", null)
        .lte("respondida_at", new Date(ahora.getTime() - 4 * HORA).toISOString())
        .gte("respondida_at", new Date(ahora.getTime() - 24 * HORA).toISOString())
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    respondio: async (senal) => {
      if (!supabase) return false;
      const lid = String(senal.respuesta_destino_lid || "").replace(/@.*$/, "");
      const ors = [`senal_id.eq.${senal.id}`];
      if (lid) ors.push(`remitente_lid.eq.${lid}`, `remitente_lid.eq.${lid}@lid`);
      const { data } = await supabase
        .from("linea_dm")
        .select("id")
        .or(ors.join(","))
        .gte("fecha_mensaje", senal.respondida_at)
        .limit(1);
      return Boolean(data && data.length);
    },
    soloLlamada: (orgId, senal) =>
      require("../data/colegas").esSoloLlamada(orgId, {
        lid: String(senal.respuesta_destino_lid || "").replace(/@.*$/, "") || null,
        telefono: senal.respuesta_destino_telefono || null,
      }),
    telefonoDe: async (senal) => {
      if (senal.respuesta_destino_telefono) return senal.respuesta_destino_telefono;
      if (!supabase) return null;
      const lid = String(senal.respuesta_destino_lid || "").replace(/@.*$/, "").replace(/\D/g, "");
      if (!lid) return null;
      const { data } = await supabase.from("colegas_grupos").select("telefono").eq("lid", lid).not("telefono", "is", null).limit(1);
      return (data && data[0] && data[0].telefono) || null;
    },
    contarHoy: async (ahora) => {
      if (!supabase) return 0;
      const { count } = await supabase
        .from("group_signals")
        .select("id", { count: "exact", head: true })
        .eq("seguimiento_dm_canal", "linea_grupos")
        .gte("seguimiento_dm_at", new Date(ahora.getTime() - 24 * HORA).toISOString());
      return count || 0;
    },
    sesion: async (orgId) => {
      const sesiones = await require("../data/whatsapp-groups").listSessions(orgId).catch(() => []);
      const activa = sesiones.find((x) => x.estado === "activa");
      return activa ? activa.nombre : null;
    },
    cuota: (sesion) => require("../lib/waha").cuotaDeLinea(sesion),
    plantilla: (...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a),
    linea: (...a) => require("../lib/waha").enviarDm(...a),
    marcar: async (id, canal) => {
      if (!supabase) return;
      await supabase.from("group_signals").update({ seguimiento_dm_at: new Date().toISOString(), seguimiento_dm_canal: canal }).eq("id", id);
    },
    listarSofi24: async (ahora) => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, org_id, nombre, phone, seguimiento")
        .eq("source", "colega")
        .not("seguimiento->>t24_sent_at", "is", null)
        .is("seguimiento->>colega_24h_at", null)
        .limit(100);
      if (error) throw error;
      const conversations = require("../data/conversations");
      const listos = [];
      for (const lead of data || []) {
        const conv = await conversations.findOrCreate(lead.org_id, lead.id, null).catch(() => null);
        const last = conv ? await conversations.lastMessage(conv.id).catch(() => null) : null;
        if (last && last.role === "assistant" && ahora.getTime() - new Date(last.created_at).getTime() >= 24 * HORA) listos.push(lead);
      }
      return listos;
    },
    marcarSofi24: async (lead) => {
      await require("../data/leads").update(lead.id, {
        seguimiento: { ...(lead.seguimiento || {}), colega_24h_at: new Date().toISOString() },
      });
    },
  };
}

let corriendo = false;
async function runOnce({ ahora = new Date(), deps = {} } = {}) {
  if (reglas.enSilencio(ahora)) return { dm: 0, sofi24: 0, noche: true };
  if (corriendo) return { dm: 0, sofi24: 0 };
  corriendo = true;
  const d = { ...depsPorDefecto(), ...deps };
  let dm = 0;
  let sofi24 = 0;
  try {
    const org = await d.org();
    if (!org) return { dm, sofi24 };

    if (process.env.RADAR_SEGUIMIENTO_DM !== "false") {
      const senales = await d.listar(ahora).catch((e) => {
        console.error("[seguimiento-colega] no se pudieron leer los DM:", e.message);
        return [];
      });
      let enviadosHoy = senales.length ? await d.contarHoy(ahora).catch(() => TOPE_DIA) : 0;
      let sesion = null;
      let cuota = null;
      for (const senal of senales) {
        try {
          const respondio = await d.respondio(senal).catch(() => true);
          const soloLlamada = await d.soloLlamada(org.id, senal).catch(() => null);
          const telefono = await d.telefonoDe(senal).catch(() => null);
          if (!telefono && !sesion) {
            sesion = await d.sesion(org.id).catch(() => null);
            cuota = sesion ? await d.cuota(sesion).catch(() => null) : null;
          }
          const canal = decidirSeguimientoDm({
            respondio,
            soloLlamada,
            telefono,
            topeOk: enviadosHoy < TOPE_DIA,
            // Sin dato de cuota no se escribe por la linea: nunca un cero optimista.
            cuotaOk: Boolean(sesion && cuota && cuota.fraccion < 0.8),
          });
          let r = { ok: true };
          if (canal === "plantilla") {
            r = await d.plantilla(org, telefono, {
              name: "seguimiento_colega",
              bodyParams: [primerNombre(senal.autor_nombre) || "colega", pedidoCorto(senal)],
            });
          } else if (canal === "linea_grupos") {
            r = await d.linea(sesion, null, textoLineaGrupos(senal, org), { lid: senal.respuesta_destino_lid, orgId: org.id });
            if (r && r.ok) enviadosHoy++;
          }
          // tope / cuota: no se marca, se reintenta en el proximo tick (dentro de las 24 h).
          if (canal === "tope" || canal === "cuota") continue;
          if (r && r.ok) {
            await d.marcar(senal.id, canal);
            if (canal === "plantilla" || canal === "linea_grupos") dm++;
          } else {
            console.warn(`[seguimiento-colega] no salio el seguimiento de la señal ${senal.id} (${canal}): ${r && r.error}`);
          }
        } catch (e) {
          console.error("[seguimiento-colega] error con la señal", senal.id, e.message);
        }
      }
    }

    if (process.env.SOFI_SEGUIMIENTO_COLEGA !== "false") {
      const leadsListos = await d.listarSofi24(ahora).catch((e) => {
        console.error("[seguimiento-colega] no se pudieron leer los colegas de +24 h:", e.message);
        return [];
      });
      for (const lead of leadsListos) {
        const r = await d
          .plantilla(org, lead.phone, { name: "seguimiento_colega", bodyParams: [primerNombre(lead.nombre) || "colega", "tu pedido"] })
          .catch((e) => ({ ok: false, error: e.message }));
        if (r && r.ok) {
          await d.marcarSofi24(lead).catch(() => {});
          sofi24++;
        }
      }
    }
    if (dm || sofi24) console.log(`[seguimiento-colega] ${dm} seguimiento(s) de DM, ${sofi24} de +24 h`);
    return { dm, sofi24 };
  } finally {
    corriendo = false;
  }
}

let timer = null;
function start() {
  const tick = () => runOnce().catch((e) => console.error("[seguimiento-colega] runOnce:", e.message));
  setTimeout(tick, 2 * 60 * 1000);
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  console.log(`[seguimiento-colega] activo — cada ${INTERVALO_MIN} min, tope ${TOPE_DIA}/dia por la linea de grupos`);
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { decidirSeguimientoDm, textoLineaGrupos, runOnce, start, stop };
