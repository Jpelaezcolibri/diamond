// Nadie queda sin contactar (Juan, 2026-10-29). Cada 15 min, en horario habil
// (8 a. m.-8 p. m., no domingo), busca a quien Sofi no logro retomar y le pasa
// el caso a una asesora por WhatsApp, con el contacto y lo que quedo
// pendiente (regla pura en src/lib/sin-respuesta.js):
//   - no contesto el seguimiento de Sofi en 3 h (scheduler/followups.js);
//   - Sofi no alcanzo a hacer el seguimiento (ventana cerrada o noche);
//   - pidio un asesor y en 2 h nadie le escribio (caso Freddy);
//   - mando una nota de voz que Sofi no puede escuchar (caso Luz Stella).
// Una vez por episodio (leads.seguimiento.asesor_at). El chat queda en "Para
// atender" del CRM (atencion_pendiente "sin_respuesta" o "pide_asesor").
//
// A quien: la asesora duena del chat si tiene la ventana de 24 h abierta; si
// no, las del ciclo con la ventana abierta, por turno. Si ninguna la tiene
// abierta, campana + aviso_app (el texto libre no llegaria: 131047).
// Respeta ritmo-avisos: lo que este listo para la misma asesora en la misma
// vuelta sale en un solo mensaje; si el freno esta cerrado, espera la proxima.
// Este carril NO lo apaga ASESORA_SOLO_VISITAS: es pedido expreso de Juan.
// Interruptor: SOFI_SIN_RESPUESTA (encendido salvo "false").
const { motivoEscalar, textoParaAsesora } = require("../lib/sin-respuesta");
const { enPausa } = require("../lib/agenda-reglas");
const ritmo = require("../lib/ritmo-avisos");

const INTERVALO_MIN = Number(process.env.SIN_RESPUESTA_INTERVALO_MIN || 15);
const MAX_POR_TICK = 10;
const H = 60 * 60 * 1000;
const VALORES_APAGADO = new Set(["false", "0", "no", "off"]);

function activo() {
  return !VALORES_APAGADO.has(String(process.env.SOFI_SIN_RESPUESTA ?? "").trim().toLowerCase());
}

function depsPorDefecto() {
  return {
    orgs: () => require("../data/organizations").listActive(),
    candidatos: async (orgId, ahora) => {
      const supabase = require("../data/supabase");
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("conversations")
        .select("id, modo, leads!inner(*)")
        .eq("org_id", orgId)
        .eq("estado", "activa")
        .or("modo.is.null,modo.eq.bot")
        .gte("last_activity_at", new Date(ahora.getTime() - 48 * H).toISOString())
        .lte("last_activity_at", new Date(ahora.getTime() - 2 * H).toISOString())
        .neq("leads.source", "asesor")
        .order("last_activity_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    mensajes: (convId) => require("../data/conversations").getRecentMessages(convId, 12),
    ciclo: (orgId) => require("../data/rotacion-citas").asesoresDelCiclo(orgId),
    conVentana: (org, ciclo, ahora) => require("../lib/ventana-asesoras").conVentana(org, ciclo, { ahora }),
    claim: (leadId) => require("../data/leads").claimSeguimiento(leadId, "asesor_at"),
    esAgente: (orgId, tel) => require("../data/colegas").esAgente(orgId, { telefono: tel }),
    soloLlamada: (orgId, tel) => require("../data/colegas").esSoloLlamada(orgId, { telefono: tel }),
    // El lead del colega casi nunca tiene nombre: el que firma en los grupos
    // vive en colegas_grupos.
    nombreColega: async (orgId, tel) => ((await require("../data/colegas").porTelefono(orgId, tel)) || {}).nombre || null,
    enviar: (...a) => require("../lib/mensaje-asesor").enviarYRegistrar(...a),
    avisarAsesor: (...a) => require("../notifications/avisar-asesor").avisarAsesor(...a),
    crmUrl: String(process.env.CRM_PUBLIC_URL || "").trim().replace(/\/$/, "") || null,
  };
}

const ultimoDe = (msgs, role) => [...msgs].reverse().find((m) => m.role === role) || null;

let turno = 0;
let corriendo = false;
async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const res = { escalados: 0, enviados: 0, soloCampana: 0, esperando: 0 };
  if (corriendo || enPausa(ahora)) return res;
  corriendo = true;
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  try {
    for (const org of await d.orgs()) {
      const convs = await d.candidatos(org.id, ahora).catch((e) => {
        console.error("[sin-respuesta] no se pudieron leer los candidatos:", e.message);
        return [];
      });
      let ciclo = null;
      let abiertas = null;
      const porAsesora = new Map(); // advisor.id -> { advisor, casos: [] }
      let listos = 0;
      for (const conv of convs) {
        if (listos >= MAX_POR_TICK) break;
        const lead = conv.leads;
        if (!lead) continue;
        try {
          const msgs = await d.mensajes(conv.id);
          if (!msgs || msgs.length === 0) continue;
          const ultimoUsuario = ultimoDe(msgs, "user");
          const paso = motivoEscalar({ lead, ultimoUsuario, ultimoMensaje: msgs[msgs.length - 1], ahora });
          if (!paso) continue;
          if (lead.source === "colega" && (await d.esAgente(org.id, lead.phone).catch(() => false))) continue;

          if (!ciclo) {
            ciclo = await d.ciclo(org.id).catch(() => []);
            abiertas = await d.conVentana(org, ciclo, ahora).catch(() => []);
          }
          if (ciclo.length === 0) {
            console.warn(`[sin-respuesta] ${org.name}: no hay asesoras en el ciclo — el caso de lead ${lead.id} queda sin pasar`);
            continue;
          }
          const duena = abiertas.find((a) => a.id === lead.transferido_advisor_id);
          const advisor = duena || (abiertas.length ? abiertas[turno++ % abiertas.length] : ciclo[0]);
          const conVentanaAbierta = abiertas.some((a) => a.id === advisor.id);
          if (conVentanaAbierta && !ritmo.puedeEnviar(advisor.id, ahora.getTime()) && !porAsesora.has(advisor.id)) {
            res.esperando++;
            continue; // freno de ritmo cerrado: la proxima vuelta
          }
          if (!(await d.claim(lead.id))) continue;
          listos++;
          const solo = lead.source === "colega" ? await d.soloLlamada(org.id, lead.phone).catch(() => false) : false;
          const nombre = lead.nombre || (lead.source === "colega" ? await d.nombreColega(org.id, lead.phone).catch(() => null) : null);
          const texto = textoParaAsesora({
            lead: { ...lead, nombre }, motivo: paso.motivo, ultimoUsuario, ultimoSofi: ultimoDe(msgs, "assistant"),
            crmUrl: d.crmUrl ? `${d.crmUrl}/inbox/${conv.id}` : null, soloLlamada: solo === true,
          });
          if (!porAsesora.has(advisor.id)) porAsesora.set(advisor.id, { advisor, conVentanaAbierta, casos: [] });
          porAsesora.get(advisor.id).casos.push({ lead: { ...lead, nombre }, paso, texto });
        } catch (e) {
          console.error("[sin-respuesta] error con lead", lead.id, e.message);
        }
      }

      for (const { advisor, conVentanaAbierta, casos } of porAsesora.values()) {
        let llego = false;
        if (conVentanaAbierta) {
          const cuerpo = casos.map((c) => c.texto).join("\n\n— — —\n\n");
          const r = await d.enviar(org, String(advisor.phone).replace(/\D/g, ""), cuerpo).catch((e) => ({ ok: false, error: e.message }));
          llego = Boolean(r && r.ok);
          if (llego) {
            ritmo.registrarEnvio(advisor.id, ahora.getTime());
            res.enviados++;
          } else console.warn(`[sin-respuesta] no salio el WhatsApp a ${advisor.name}: ${r && r.error}`);
        }
        for (const c of casos) {
          res.escalados++;
          if (!llego) res.soloCampana++;
          const motivo = c.paso.motivo === "pide_asesor" ? "pide_asesor" : "sin_respuesta";
          const quien = c.lead.nombre || `+${c.lead.phone}`;
          await d
            .avisarAsesor({ org, advisor, motivo, lead: c.lead, titulo: `Hay que contactar a ${quien}`, cuerpo: c.texto, whatsapp: !llego })
            .catch((e) => console.warn("[sin-respuesta] campana:", e.message));
          console.log(`[sin-respuesta] ${c.paso.motivo}: lead ${c.lead.id} -> ${advisor.name}${llego ? " (WhatsApp)" : " (campana + aviso_app)"}`);
        }
      }
    }
    return res;
  } finally {
    corriendo = false;
  }
}

let timer = null;
function start() {
  if (!activo()) {
    console.log("[sin-respuesta] apagado (SOFI_SIN_RESPUESTA=false)");
    return null;
  }
  const tick = () => runOnce().catch((e) => console.error("[sin-respuesta] runOnce:", e.message));
  setTimeout(tick, 90 * 1000);
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  console.log(`[sin-respuesta] activo — cada ${INTERVALO_MIN} min`);
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runOnce, start, stop, activo };
