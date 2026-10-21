// Recordatorio de la visita (2 h antes) y pregunta de como le fue (3 h
// despues) al cliente o colega, por el canal de Sofi (spec 2026-10-21
// sofi-super-agente §2.3).
//
// Solo citas CONFIRMADAS de tipo visita. Una vez por cita: la marca va dentro de
// leads.cita (recordatorio_cliente_at / postvisita_at) y se pone ANTES de
// enviar (claim), para que dos corridas no manden dos veces; si el envio falla
// la marca se suelta. Fuera de la ventana de 24 h solo sale una plantilla
// (SOFI_RECORDATORIO_PLANTILLA / SOFI_POSTVISITA_PLANTILLA); sin plantilla no
// sale nada y queda en el log.
//
// Interruptores, apagados por defecto: SOFI_RECORDATORIO_VISITA y SOFI_POSTVISITA.

const H = 60 * 60 * 1000;
const ANTES_MS = 2 * H;
const DESPUES_MS = 3 * H;
// Una visita de ayer a la tarde no se pregunta dos dias despues.
const POSTVISITA_MAX_MS = 20 * H;
const VALORES_ENCENDIDO = new Set(["true", "1", "si", "on", "yes"]);

let enviadosEsteProceso = new Set();

function encendido(nombre) {
  return VALORES_ENCENDIDO.has(String(process.env[nombre] ?? "").trim().toLowerCase());
}
const recordatorioActivo = () => encendido("SOFI_RECORDATORIO_VISITA");
const postvisitaActivo = () => encendido("SOFI_POSTVISITA");

function primerNombre(lead) {
  return String((lead && lead.nombre) || "").trim().split(/\s+/)[0] || "";
}

function saludo(lead) {
  const n = primerNombre(lead);
  return n ? `Hola ${n}` : "Hola";
}

function textoRecordatorio({ lead, hora, ref, zona, alias }) {
  const donde = ref ? ` a la Ref ${ref}${zona ? ` en ${zona}` : ""}` : "";
  return `${saludo(lead)}, te recuerdo tu visita de hoy a las ${hora}${donde}. Te recibe ${alias}. Si necesitas moverla, respóndeme aquí y la reagendamos.`;
}

function textoPostvisita({ lead, ref }) {
  const de = ref ? `la Ref ${ref}` : "la propiedad";
  if (lead && lead.source === "colega") {
    return `${saludo(lead)}, ¿qué le pareció ${de} a tu cliente? Si quiere avanzar o ver otras opciones parecidas, aquí estoy.`;
  }
  return `${saludo(lead)}, ¿qué te pareció ${de}? Cuéntame qué te gustó y qué no, y te ayudo con el siguiente paso.`;
}

/** "recordatorio" | "postvisita" | null, segun el reloj y las marcas de la cita. */
function pasoPendiente(cita, ahora = new Date()) {
  if (!cita || cita.estado !== "confirmada" || cita.tipo !== "visita") return null;
  if (cita.origen === "linea_dm") return null;
  const t = new Date(cita.fecha_hora).getTime();
  if (isNaN(t)) return null;
  const dt = t - ahora.getTime();
  if (postvisitaActivo() && !cita.postvisita_at) {
    const despues = ahora.getTime() - t;
    if (despues >= DESPUES_MS && despues <= POSTVISITA_MAX_MS) return "postvisita";
  }
  if (recordatorioActivo() && !cita.recordatorio_cliente_at && dt > 0 && dt <= ANTES_MS) return "recordatorio";
  return null;
}

function depsPorDefecto() {
  const supabase = () => require("../data/supabase");
  return {
    orgs: () => require("../data/organizations").listActive(),
    candidatos: async (org) => {
      const sb = supabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from("leads").select("id, org_id, nombre, phone, source, cita")
        .eq("org_id", org.id)
        .eq("cita->>estado", "confirmada")
        // Ventana ancha en texto (los offsets de fecha_hora varian); pasoPendiente afina.
        .gte("cita->>fecha_hora", new Date(Date.now() - 48 * 3600e3).toISOString())
        .lte("cita->>fecha_hora", new Date(Date.now() + 48 * 3600e3).toISOString())
        .order("cita->>fecha_hora", { ascending: true }).limit(1000);
      if (error) throw error;
      return data || [];
    },
    soloLlamada: (org, tel) => require("../data/colegas").esSoloLlamada(org.id, { telefono: tel }),
    asesor: (org, id) => (id ? require("../data/advisors").findById(org.id, id) : null),
    zona: async (org, ref) => {
      const p = ref ? await require("../data/properties").findByRef(org, ref) : null;
      return (p && (p.zona || p.barrio)) || null;
    },
    conversacion: async (org, lead) => {
      const sb = supabase();
      if (!sb) return null;
      const { data } = await sb
        .from("conversations").select("id, whatsapp_phone_id").eq("lead_id", lead.id).eq("estado", "activa")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data || null;
    },
    ultimoDelCliente: (convId) => require("../data/conversations").lastUserMessageAt(convId),
    enviarTexto: (org, tel, texto, fromPhoneId) => require("../channels/whatsapp").sendWhatsApp(org, tel, texto, { fromPhoneId }),
    enviarPlantilla: (org, tel, plantilla, fromPhoneId) => require("../channels/whatsapp").sendWhatsAppTemplate(org, tel, { ...plantilla, fromPhoneId }),
    registrar: (convId, texto) => require("../data/conversations").appendMessage(convId, "assistant", texto),
    // Lee la cita fresca y cambia SOLO esta llave: no pisa lo que otro proceso
    // haya hecho en la cita (confirmar, reprogramar). false si ya estaba marcada.
    marcar: async (lead, llave, valor) => {
      const leads = require("../data/leads");
      const sb = supabase();
      let cita;
      if (sb) {
        const { data } = await sb.from("leads").select("cita").eq("id", lead.id).single();
        cita = data && data.cita;
      } else {
        const l = await leads.findById(lead.org_id, lead.id);
        cita = l && l.cita;
      }
      if (!cita) return false;
      if (valor && cita[llave]) return false;
      await leads.update(lead.id, { cita: { ...cita, [llave]: valor } });
      return true;
    },
  };
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  if (!recordatorioActivo() && !postvisitaActivo()) return { enviados: 0 };
  if (require("../lib/agenda-reglas").enSilencio(ahora)) return { enviados: 0, quiet: true };
  const { ventanaAbierta } = require("./followups");
  const { formatCitaFechaHora } = require("../notifications/advisor");
  const { aliasPublico } = require("../lib/identidad-publica");
  const d = deps || depsPorDefecto();
  let enviados = 0;
  for (const org of await d.orgs()) {
    let leads = [];
    try {
      leads = await d.candidatos(org, ahora);
    } catch (e) {
      console.error(`[visita-cliente] ${org.name}: no se pudieron leer citas:`, e.message);
      continue;
    }
    for (const lead of leads) {
      const paso = pasoPendiente(lead.cita, ahora);
      if (!paso || !lead.phone) continue;
      const clave = `${lead.id}:${paso}:${lead.cita.fecha_hora}`;
      if (enviadosEsteProceso.has(clave)) continue;
      try {
        if (lead.source === "colega" && (await d.soloLlamada(org, lead.phone)) !== false) continue;
        const conv = await d.conversacion(org, lead);
        if (!conv) continue;
        const ultimo = await d.ultimoDelCliente(conv.id);
        const abierta = ventanaAbierta(ultimo, ahora);
        const nombrePlantilla = process.env[paso === "recordatorio" ? "SOFI_RECORDATORIO_PLANTILLA" : "SOFI_POSTVISITA_PLANTILLA"];
        if (!abierta && !nombrePlantilla) {
          console.log(`[visita-cliente] ${paso} a +${lead.phone}: ventana cerrada y sin plantilla, no sale`);
          continue;
        }
        const ref = lead.cita.ref || null;
        // Meta rechaza parametros vacios: sin ref no hay plantilla.
        if (!abierta && !ref) {
          console.log(`[visita-cliente] ${paso} a +${lead.phone}: ventana cerrada y la cita no tiene ref, la plantilla no sale`);
          continue;
        }
        const fh = formatCitaFechaHora(lead.cita.fecha_hora);
        const hora = fh ? fh.hora : "la hora acordada";
        let texto, params;
        if (paso === "recordatorio") {
          const asesor = await d.asesor(org, lead.cita.asesor_id);
          const alias = aliasPublico(asesor, org);
          const zona = ref ? await d.zona(org, ref) : null;
          texto = textoRecordatorio({ lead, hora, ref, zona, alias });
          params = [primerNombre(lead) || "cliente", hora, String(ref), zona || "la zona acordada", alias || "tu asesor"];
        } else {
          texto = textoPostvisita({ lead, ref });
          params = [primerNombre(lead) || "cliente", String(ref)];
        }
        const llave = paso === "recordatorio" ? "recordatorio_cliente_at" : "postvisita_at";
        // Claim antes de enviar: nada sale dos veces.
        if (!(await d.marcar(lead, llave, ahora.toISOString()))) continue;
        enviadosEsteProceso.add(clave);
        const r = await (abierta
          ? d.enviarTexto(org, lead.phone, texto, conv.whatsapp_phone_id)
          : d.enviarPlantilla(org, lead.phone, { name: nombrePlantilla, bodyParams: params }, conv.whatsapp_phone_id)
        ).catch((e) => ({ ok: false, error: e.message }));
        if (!r || !r.ok) {
          console.warn(`[visita-cliente] ${paso} no salió a +${lead.phone}: ${r && r.error}`);
          enviadosEsteProceso.delete(clave);
          await d.marcar(lead, llave, null).catch(() => {});
          continue;
        }
        await d.registrar(conv.id, texto).catch(() => {});
        enviados++;
        console.log(`[visita-cliente] ${paso} a +${lead.phone} (${abierta ? "texto" : "plantilla"})`);
      } catch (e) {
        console.error(`[visita-cliente] ${paso} lead ${lead.id}:`, e.message);
      }
    }
  }
  return { enviados };
}

function start() {
  if (!recordatorioActivo() && !postvisitaActivo()) {
    console.log("[visita-cliente] apagado (SOFI_RECORDATORIO_VISITA / SOFI_POSTVISITA)");
    return;
  }
  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try { await runOnce(); } catch (e) { console.error("[visita-cliente] runOnce:", e.message); } finally { corriendo = false; }
  };
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, 10 * 60 * 1000);
  console.log(`[visita-cliente] activo — recordatorio ${recordatorioActivo()}, postvisita ${postvisitaActivo()}, cada 10 min, 8am-8pm`);
}

function _reset() {
  enviadosEsteProceso = new Set();
}

module.exports = { start, runOnce, pasoPendiente, textoRecordatorio, textoPostvisita, _reset };
