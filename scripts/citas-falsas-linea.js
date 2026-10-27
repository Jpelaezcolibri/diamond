#!/usr/bin/env node
// Limpieza de las dos citas falsas de la linea del radar (Juan, 2026-10-27).
//
//   node scripts/citas-falsas-linea.js            -> en seco: solo lista (SELECT)
//   node scripts/citas-falsas-linea.js --aplicar  -> las marca estado='cancelada'
//
// Las dos salieron de visita-linea.js leyendo mensajes que no eran de un
// colega:
//   - "Diamond" (lid 48297494470698): Sofi hablandole a Daiana por la linea
//     oficial, antes del filtro de ecos (9e83553, 23-oct).
//   - "cathe Uribe relator" (lid 269230108872829): Catherine, del equipo,
//     coordinando con Daiana; ademas quedo con la ref de otra propiedad.
//
// Solo toca citas con origen 'linea_dm' de esos dos lids. No borra nada: la
// cita conserva todos sus campos y suma estado_anterior, cancelada_at,
// cancelada_por='script' y cancelada_motivo. Si el lead tenia
// atencion_pendiente='visita', se limpia. Idempotente: una ya cancelada no
// vuelve a salir. No le escribe a nadie. Solo con el OK de Juan para --aplicar.
const supabase = require("../src/data/supabase");

const aplicar = process.argv.includes("--aplicar");

const FALSAS = {
  "48297494470698@lid": "Mensaje de Sofi a Daiana leído como colega (eco de la línea oficial)",
  "269230108872829@lid": "Mensaje de Catherine (equipo) leído como colega; ref equivocada",
};

async function main() {
  if (!supabase) {
    console.error("Sin SUPABASE_URL/SUPABASE_SERVICE_KEY configurados.");
    process.exit(1);
  }
  const { data, error } = await supabase
    .from("leads")
    .select("id, nombre, phone, source, cita, atencion_pendiente")
    .in("phone", Object.keys(FALSAS))
    .not("cita", "is", null);
  if (error) throw error;

  const falsas = (data || []).filter((l) => l.cita.origen === "linea_dm" && l.cita.estado !== "cancelada");
  console.log(`${aplicar ? "APLICAR" : "EN SECO"} — ${falsas.length} cita(s) falsa(s) de la línea:`);
  for (const l of falsas) {
    const c = l.cita;
    console.log(
      [
        `- ${l.id}`,
        l.nombre || "(sin nombre)",
        l.phone,
        `estado=${c.estado}`,
        `ref=${c.ref || "-"}`,
        `fecha_hora=${c.fecha_hora || "-"}`,
        `creada_at=${c.creada_at || "-"}`,
        `atencion=${l.atencion_pendiente || "-"}`,
        `motivo: ${FALSAS[l.phone]}`,
      ].join(" | ")
    );
  }
  if (!aplicar) {
    console.log("\nNo se cambió nada. Para cancelarlas: node scripts/citas-falsas-linea.js --aplicar");
    return;
  }
  const ahora = new Date().toISOString();
  let ok = 0;
  for (const l of falsas) {
    const cita = { ...l.cita, estado: "cancelada", estado_anterior: l.cita.estado, cancelada_at: ahora, cancelada_por: "script", cancelada_motivo: FALSAS[l.phone] };
    const patch = { cita };
    if (l.atencion_pendiente === "visita") {
      patch.atencion_pendiente = null;
      patch.atencion_desde = null;
    }
    // Solo si la cita sigue como se listó (otro proceso pudo tocarla en el medio).
    const { error: e } = await supabase.from("leads").update(patch).eq("id", l.id).eq("cita->>estado", l.cita.estado);
    if (e) console.error(`No se pudo cancelar ${l.id}:`, e.message);
    else ok++;
  }
  console.log(`\nCanceladas: ${ok} de ${falsas.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
