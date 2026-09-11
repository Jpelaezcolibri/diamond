#!/usr/bin/env node
// Uso unico (2026-09-11): las citas que ya existen con estado "solicitada"
// (el valor que agendar_cita escribia antes de esta spec) pasan a
// "propuesta" -- si no, citas.estadoDe() las sigue leyendo como "confirmada"
// y confirmar_cita nunca las va a encontrar como pendientes.
//
// Correr con la clave de PRODUCCION, no la local:
//   railway run --service diamond node scripts/backfill-citas-propuesta.js
const supabase = require("../src/data/supabase");

async function main() {
  if (!supabase) {
    console.error("Sin SUPABASE_URL/SUPABASE_SERVICE_KEY configurados.");
    process.exit(1);
  }
  const { data, error } = await supabase
    .from("leads")
    .select("id, nombre, cita")
    .not("cita", "is", null)
    .limit(1000);
  if (error) throw error;

  const aCorregir = (data || []).filter((l) => l.cita && l.cita.estado === "solicitada");
  console.log(`${aCorregir.length} cita(s) con estado "solicitada" encontradas.`);

  for (const l of aCorregir) {
    const cita = { ...l.cita, estado: "propuesta" };
    const { error: errUpdate } = await supabase.from("leads").update({ cita }).eq("id", l.id);
    if (errUpdate) {
      console.error(`No se pudo corregir la cita de ${l.nombre || l.id}:`, errUpdate.message);
    } else {
      console.log(`Corregida: ${l.nombre || l.id} -> propuesta`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
