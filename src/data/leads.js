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
    }
    return lead;
  }
  const { data: existing, error: findError } = await supabase
    .from("leads").select("*").eq("org_id", orgId).eq("phone", phone).maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;
  const { data, error } = await supabase
    .from("leads").insert({ org_id: orgId, phone, source }).select().single();
  if (error) throw error;
  return data;
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

module.exports = { findOrCreate, update };
