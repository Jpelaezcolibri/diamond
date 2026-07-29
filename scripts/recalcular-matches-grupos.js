#!/usr/bin/env node
// Recalcula los matches de las demandas ya guardadas con el cruce nuevo.
//
//   node scripts/recalcular-matches-grupos.js            (simulacion, no escribe)
//   node scripts/recalcular-matches-grupos.js --aplicar   (escribe de verdad)
//
// POR QUE HACE FALTA: `group_signals.matches` se calcula UNA vez, al detectar
// la senal, y queda congelado en la fila. Cuando el cruce mejora, lo ya
// guardado sigue mostrando los matches viejos — el asesor abre la pantalla y
// ve los falsos positivos de antes, sin forma de saber que la logica cambio.
//
// El cruce nuevo (2026-07-29) endurecio las compuertas: la zona se compara
// contra la zona y no contra la ciudad, el precio es una banda y no un techo,
// y las alcobas admiten la exacta o una mas. Medido sobre estas mismas filas,
// los matches pasan de 99 a 13 — y 656 de los ~731 eliminados morian por el
// cruce zona/ciudad, que era un bug.
//
// Solo toca la columna `matches`. No reclasifica (no gasta un token de IA), no
// vuelve a avisar a nadie y no toca `enviado_at`: una demanda que ya se avisó
// no se avisa de nuevo por haber recalculado.

const organizations = require("../src/data/organizations");
const supabase = require("../src/data/supabase");
const { cruzar } = require("../src/groups/match");

const APLICAR = process.argv.includes("--aplicar");

const limpio = (s) => String(s || "").replace(/\s+/g, " ").trim();

async function main() {
  if (!supabase) {
    console.error("Sin Supabase configurado. Exporta SUPABASE_URL y SUPABASE_SERVICE_KEY.");
    process.exit(1);
  }
  const org = await organizations.getDefault();

  const { data: filas, error } = await supabase
    .from("group_signals")
    .select("id, autor_nombre, operacion, tipo, zona, ciudad, precio_min, precio_max, habitaciones, texto_original, matches")
    .eq("org_id", org.id)
    .eq("clase", "demanda")
    .order("created_at", { ascending: false });
  if (error) throw error;

  console.log(`${filas.length} demanda(s) guardadas.${APLICAR ? "" : "  [SIMULACION — no escribe]"}\n`);

  let antes = 0;
  let ahora = 0;
  let cambiadas = 0;

  for (const f of filas) {
    const previos = f.matches || [];
    const viejos = previos.length;
    antes += viejos;

    // Se reusa el mismo cruce que corre en vivo: si esto y produccion se
    // separan, el recalculo miente.
    const [demanda] = (await cruzar([{ ...f, clase: "demanda", mensaje: {} }], { org })).demandas;
    const nuevos = demanda.matches || [];
    ahora += nuevos.length;

    // Comparar el CONTENIDO, no la cantidad. Comparando solo el largo, una
    // demanda cuyos matches siguen siendo dos no se reescribia nunca — y se
    // quedaba con la forma vieja del objeto. Paso de verdad el 2026-07-29:
    // avisos que salieron sin el link a la ficha y sin las alcobas, porque
    // esos campos se agregaron despues y esas filas nunca se refrescaron.
    if (JSON.stringify(previos) === JSON.stringify(nuevos)) continue;

    cambiadas++;
    console.log(`· ${limpio(f.autor_nombre) || "Colega"}  [${viejos} → ${nuevos.length}]`);
    console.log(`  pide: ${f.tipo || "?"} en ${limpio(f.zona || f.ciudad) || "(sin ubicación)"}` +
      `${f.precio_max ? ` hasta $${Math.round(f.precio_max / 1e6)}M` : ""}${f.habitaciones ? `, ${f.habitaciones} alc` : ""}`);
    for (const m of nuevos.slice(0, 3)) {
      console.log(`     ${m.puntaje}%  ${limpio(m.titulo).slice(0, 55)}`);
      console.log(`           ${m.razones.join("  |  ")}`);
    }

    if (APLICAR) {
      const { error: e } = await supabase
        .from("group_signals")
        .update({ matches: nuevos, updated_at: new Date().toISOString() })
        .eq("id", f.id);
      if (e) console.error(`  !! no se pudo actualizar: ${e.message}`);
    }
  }

  console.log(`\nmatches: ${antes} → ${ahora}  ·  ${cambiadas} demanda(s) cambian`);
  if (!APLICAR) console.log("\nNada se escribió. Volvé a correrlo con --aplicar para guardarlo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
