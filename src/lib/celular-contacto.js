// El celular de contacto que deja un colega o cliente en el chat (Juan,
// 2026-11-09): "si el colega ya dio el número telefónico que se actualice en
// la cita, busca la forma de que no se pierda la información". Caso Norha
// Vélez: WhatsApp le ocultaba el número (lead.phone = "CO.1622…"), lo escribió
// en el chat y quedó solo en el texto; los avisos seguían diciendo "sin
// celular visible" y nadie la llamó.
//
// Se captura en el motor al entrar el mensaje, sin depender de que Sofi use
// una herramienta. Se guarda en leads.celular (migración
// 2026-11-09_lead_celular.sql) y, si hay cita, también en cita.celular_contacto:
// así lo ven las consultas que solo traen la cita y nada se pierde si la
// migración aún no corrió. Todo lo que muestra un teléfono lee celularDe().
const { sinCelular, celularDe, legible } = require("./quien-lead");

// Celular colombiano: 3XX XXX XXXX, con +57/57 opcional y separadores.
const CELULAR = /(?<!\d)(?:\+?57[\s.-]*)?(3\d{2})[\s.-]*(\d{3})[\s.-]*(\d{4})(?!\d)/g;
// Lo que queda de un mensaje que "es básicamente el número" ("mi cel es …").
const MAX_RESTO = 40;

function extraerCelulares(texto) {
  const vistos = new Set();
  for (const m of String(texto || "").matchAll(CELULAR)) vistos.add(`57${m[1]}${m[2]}${m[3]}`);
  return [...vistos];
}

function digitos(phone) {
  return String(phone || "").replace(/\D/g, "");
}


function celularAGuardar(lead, texto) {
  const celulares = extraerCelulares(texto);
  if (celulares.length !== 1) return null; // ninguno, o varios: no se adivina
  const cel = celulares[0];
  if (digitos(lead.celular) === cel || digitos(lead.cita && lead.cita.celular_contacto) === cel) return null;
  if (!sinCelular(lead.phone)) {
    if (digitos(lead.phone) === cel) return null; // es el mismo de su WhatsApp
    // Con número visible solo si el mensaje es básicamente ese número: en un
    // texto largo puede ser el de otra persona ("llama al propietario al …").
    const resto = String(texto || "").replace(CELULAR, "").replace(/\s+/g, " ").trim();
    if (resto.length > MAX_RESTO) return null;
  }
  return cel;
}


const esColumnaFaltante = (e) => Boolean(e) && (e.code === "42703" || e.code === "PGRST204" || /celular/.test(String(e.message || "")) && /does not exist|column/i.test(String(e.message || "")));

function depsPorDefecto() {
  return {
    actualizar: (id, patch) => require("../data/leads").update(id, patch),
    asesor: (orgId, id) => require("../data/advisors").findById(orgId, id),
    avisar: (a) => require("../notifications/avisar-asesor").avisarAsesor(a),
    ficha: (a) => require("./ficha-visita").armarFichaVisita(a),
  };
}

let avisoMigracion = false;

async function capturar({ org, lead, texto, deps = null }) {
  if (!lead || !lead.id) return null;
  const cel = celularAGuardar(lead, texto);
  if (!cel) return null;
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const cita = lead.cita ? { ...lead.cita, celular_contacto: cel } : null;
  try {
    await d.actualizar(lead.id, cita ? { celular: cel, cita } : { celular: cel });
    lead.celular = cel;
  } catch (e) {
    if (!esColumnaFaltante(e)) throw e;
    if (!avisoMigracion) {
      avisoMigracion = true;
      console.warn("[celular-contacto] Falta correr db/migrations/2026-11-09_lead_celular.sql: el celular queda solo en la cita.");
    }
    if (!cita) return null;
    await d.actualizar(lead.id, { cita });
  }
  if (cita) lead.cita = cita;
  console.log(`[celular-contacto] lead ${lead.id}: guardado ${legible(cel)}`);

  // Que se entere quien la está atendiendo: la asesora de la visita viva, o
  // a quien se le asignó el pendiente.
  const citas = require("../data/citas");
  const asesorId = (lead.cita && citas.estaViva(lead.cita) && lead.cita.asesor_id) || (lead.atencion_pendiente && lead.transferido_advisor_id) || null;
  if (asesorId) {
    const asesor = await d.asesor(org.id, asesorId).catch(() => null);
    if (asesor) {
      const quien = lead.nombre || (lead.source === "colega" ? "El colega" : "El cliente");
      const ficha = lead.cita ? await d.ficha({ org, lead, cita: lead.cita }).catch(() => null) : null;
      const detalle = `📞 *Celular:* ${legible(cel)} · wa.me/${cel}${ficha ? `\n\n${ficha}` : ""}`;
      await d
        .avisar({ org, advisor: asesor, motivo: "aviso", lead, titulo: `${quien} dejó su celular`, cuerpo: `Celular: ${legible(cel)} · wa.me/${cel}`, detalle })
        .catch((e) => console.warn("[celular-contacto] aviso:", e.message));
    }
  }
  return { celular: cel };
}

module.exports = { extraerCelulares, celularAGuardar, celularDe, capturar, legible };
