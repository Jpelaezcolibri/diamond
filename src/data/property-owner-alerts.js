// Dedup del aviso al captador: una fila por (propiedad, lead). Espejo de
// allyProperties.registerAlert (src/data/ally-properties.js).
const supabase = require("./supabase");
const memory = require("./memory");

// true → primera vez, hay que avisar; false → ya se aviso a este captador
// por este cliente y esta propiedad.
async function registerAlert(orgId, propertyId, leadId) {
  if (!supabase) {
    const key = `${propertyId}:${leadId}`;
    if (memory.propertyOwnerAlerts.includes(key)) return false;
    memory.propertyOwnerAlerts.push(key);
    return true;
  }
  const { error } = await supabase
    .from("property_owner_alerts")
    .insert({ property_id: propertyId, lead_id: leadId, org_id: orgId });
  if (error) {
    if (error.code === "23505") return false; // ya existia (violacion del unique)
    throw error;
  }
  return true;
}

module.exports = { registerAlert };
