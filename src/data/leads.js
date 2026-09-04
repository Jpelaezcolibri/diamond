const supabase = require("./supabase");
const memory = require("./memory");

async function findOrCreate(orgId, phone, source = "whatsapp") {
  if (!supabase) {
    let lead = memory.leads.find((l) => l.org_id === orgId && l.phone === phone);
    if (!lead) {
      lead = {
        id: memory.uid(), org_id: orgId, phone, nombre: null, presupuesto: null,
        zona_interes: null, tipo_interes: null, urgencia: null, forma_pago: null, categoria: "otros", score: 0,
        estado: "nuevo", property_ref_origen: null, source,
      };
      memory.leads.push(lead);
      lead._isNew = true; // recien creado: se queda en "nuevo" hasta que vuelva a escribir
    }
    return lead;
  }
  const { data: existing, error: findError } = await supabase
    .from("leads").select("*").eq("org_id", orgId).eq("phone", phone).maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;
  const { data, error } = await supabase
    .from("leads").insert({ org_id: orgId, phone, source }).select().single();
  if (error) {
    // Carrera: 2-3 mensajes casi simultaneos del mismo cliente (patron normal
    // de chat, o dos procesos/instancias) pueden insertar el mismo (org_id,
    // phone) entre el select y este insert — choca contra el unique de la
    // tabla (codigo 23505 de Postgres). Antes esto tiraba el mensaje del
    // cliente sin respuesta; ahora se relee la fila que gano la carrera.
    if (error.code === "23505") {
      const { data: retry, error: retryError } = await supabase
        .from("leads").select("*").eq("org_id", orgId).eq("phone", phone).maybeSingle();
      if (retryError) throw retryError;
      if (retry) return retry;
    }
    throw error;
  }
  data._isNew = true; // recien creado: se queda en "nuevo" hasta que vuelva a escribir
  return data;
}

// Lead por id (Juan, 2026-09-04). Nace para src/groups/cancelar-cita.js, que
// necesita leer la cita del lead antes de cancelarla; hasta hoy este modulo
// solo sabia encontrar un lead por telefono (findOrCreate), y el que tenia el
// id en la mano no tenia como leerlo.
//
// Firma (orgId, id) como TODOS los findById de src/data (advisors.js,
// mandatos.js, ally-properties.js) y no (id) a secas: el repo es multi-tenant
// y un id filtrado sin org_id devolveria la fila de otra organizacion — el
// unico costo de pedir el orgId es un argumento que el llamador ya tiene.
async function findById(orgId, id) {
  if (!id) return null;
  if (!supabase) {
    return memory.leads.find((l) => l.org_id === orgId && l.id === id) || null;
  }
  const { data, error } = await supabase
    .from("leads").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function update(leadId, fields) {
  if (!supabase) {
    const lead = memory.leads.find((l) => l.id === leadId);
    if (lead) Object.assign(lead, fields);
    return lead;
  }
  const { data, error } = await supabase
    .from("leads")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Claims atomicos para los schedulers (src/scheduler/followups.js y
// reminders.js): antes marcaban con un update() normal, que es un
// select-en-la-cabeza-del-dev-then-write — dos ticks corriendo a la vez (o,
// a futuro, dos replicas de Railway) podian ver el mismo lead como
// candidato y enviarle el aviso dos veces. Estas dos funciones llaman a
// funciones de Postgres (ver migracion 2026-07-24_claim_functions) que
// hacen el UPDATE con su propio WHERE ...is null en una sola sentencia
// atomica — algo que el cliente de Supabase no puede expresar sobre un
// campo dentro de un jsonb. Devuelven true solo si ESTA llamada gano el
// claim; false si alguien mas ya lo habia marcado.
async function claimFollowup(leadId) {
  if (!supabase) {
    const lead = memory.leads.find((l) => l.id === leadId);
    if (!lead || lead.seguimiento?.t24_sent_at) return false;
    lead.seguimiento = { ...(lead.seguimiento || {}), t24_sent_at: new Date().toISOString() };
    return true;
  }
  const { data, error } = await supabase.rpc("claim_followup", { p_lead_id: leadId });
  if (error) throw error;
  return data === true;
}

async function claimAppointmentReminder(leadId) {
  if (!supabase) {
    const lead = memory.leads.find((l) => l.id === leadId);
    if (!lead || lead.cita?.recordatorio_enviado) return false;
    lead.cita = { ...(lead.cita || {}), recordatorio_enviado: true };
    return true;
  }
  const { data, error } = await supabase.rpc("claim_appointment_reminder", { p_lead_id: leadId });
  if (error) throw error;
  return data === true;
}

module.exports = { findOrCreate, findById, update, claimFollowup, claimAppointmentReminder };
