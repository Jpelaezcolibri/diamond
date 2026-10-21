#!/usr/bin/env node
// Limpieza de las citas vencidas sin confirmar (brief citas-avisos §1, Juan
// 2026-10-21: "muéstrame las 6 viejas antes de limpiarlas").
//
//   node scripts/citas-vencidas.js            -> en seco: solo lista (SELECT)
//   node scripts/citas-vencidas.js --aplicar  -> las marca estado='vencida'
//
// Toma TODAS las citas con estado crudo solicitada/propuesta/por_confirmar
// cuya hora ya paso (viejas y nuevas). Idempotente: una ya marcada vencida no
// vuelve a salir. No borra nada: la cita conserva todos sus campos y suma
// estado_anterior, vencida_at y vencida_por='script'. Si el lead tenia
// atencion_pendiente='visita', se limpia. No le escribe a nadie.
// Solo con el OK de Juan para --aplicar.
const supabase = require("../src/data/supabase");
const cv = require("../src/lib/citas-vencidas");

const aplicar = process.argv.includes("--aplicar");

function bogota(iso) {
  try {
    return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

async function main() {
  if (!supabase) {
    console.error("Sin SUPABASE_URL/SUPABASE_SERVICE_KEY configurados.");
    process.exit(1);
  }
  const { data, error } = await supabase
    .from("leads")
    .select("id, nombre, phone, source, cita, atencion_pendiente")
    .not("cita", "is", null)
    .limit(1000);
  if (error) throw error;

  const ahora = new Date();
  const vencidas = (data || []).filter((l) => cv.pasoSinConfirmar(l.cita, ahora));
  vencidas.sort((a, b) => String(a.cita.fecha_hora).localeCompare(String(b.cita.fecha_hora)));
  console.log(`${aplicar ? "APLICAR" : "EN SECO"} — ${vencidas.length} cita(s) vencida(s) sin confirmar (de ${(data || []).length} leads con cita):`);
  for (const l of vencidas) {
    const c = l.cita;
    console.log(
      [
        `- ${l.id.slice(0, 8)}`,
        l.nombre || "(sin nombre)",
        l.source || "-",
        bogota(c.fecha_hora),
        `estado=${c.estado}`,
        `ref=${c.ref || "-"}`,
        `asesor_id=${c.asesor_id || "-"}`,
        `corte_at=${c.corte_at || "-"}`,
        `antigua=${cv.esAntigua(c) ? "si" : "no"}`,
        `atencion=${l.atencion_pendiente || "-"}`,
      ].join(" | ")
    );
  }
  if (!aplicar) {
    console.log("\nNo se cambio nada. Para marcarlas vencidas: node scripts/citas-vencidas.js --aplicar");
    return;
  }
  let ok = 0;
  for (const l of vencidas) {
    const patch = cv.patchVencida(l, { ahora, por: "script" });
    // Solo si sigue pendiente (otro proceso pudo confirmarla en el medio).
    const { error: e } = await supabase.from("leads").update(patch).eq("id", l.id).eq("cita->>estado", l.cita.estado);
    if (e) console.error(`No se pudo marcar ${l.id}:`, e.message);
    else ok++;
  }
  console.log(`\nMarcadas vencidas: ${ok} de ${vencidas.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
