#!/usr/bin/env node
// Reproduce la revalidacion de UNA señal ya guardada, contra el prompt que
// esta corriendo AHORA. No envia nada: solo imprime el veredicto.
//
// Existe porque el veredicto guardado en group_signals se produjo con el
// prompt de ESE momento. Cuando se cambia el prompt para arreglar un caso,
// la unica forma de saber si el arreglo agarro es volver a correr el mismo
// pedido contra el codigo nuevo.
//
//   railway run --service diamond node scripts/diagnostico-revalidar.js <signal_id>
//
// `railway run` inyecta las variables del servicio, asi que corre con la
// clave de PRODUCCION sin copiarla a ningun lado.

// La clave se captura ANTES de requerir src/: src/config.js corre dotenv con
// `override: true` y pisaria la clave inyectada por `railway run`.
const CLAVE_INYECTADA = process.env.ANTHROPIC_API_KEY;

const { createClient } = require("@supabase/supabase-js");
const revalidar = require("../src/groups/revalidar");

if (CLAVE_INYECTADA) process.env.ANTHROPIC_API_KEY = CLAVE_INYECTADA;

const id = process.argv[2];
if (!id) {
  console.error("Falta el id de la señal.\n  node scripts/diagnostico-revalidar.js <signal_id>");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

function lista(v) {
  return Array.isArray(v) ? v : [];
}

(async () => {
  const { data, error } = await supabase.from("group_signals").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la señal: ${error.message}`);
  if (!data) throw new Error(`No existe la señal ${id}`);

  const clasificado = {
    mensaje: { texto: data.texto_original },
    operacion: data.operacion,
    tipo: data.tipo,
    zona: (data.zonas || []).join(", ") || data.zona,
    ciudad: data.ciudad,
    precio_max: data.precio_max,
    habitaciones: data.habitaciones,
    flexible_habitaciones: data.flexible_habitaciones,
    area_min: data.area_min,
    banos: data.banos,
    garajes: data.garajes,
    estrato: data.estrato,
  };

  const matches = data.matches || [];
  console.log(`SEÑAL ${id}`);
  console.log(`  ${data.created_at} · ${data.autor_nombre}`);
  console.log(`  pedido: ${String(data.texto_original || "").slice(0, 160).replace(/\n/g, " ")}`);
  console.log(`  matches: ${matches.length}\n`);

  const guardado = data.revalidacion || {};
  console.log("VEREDICTO GUARDADO (el que se ejecuto en su momento):");
  console.log(`  utiles=${JSON.stringify(lista(guardado.refs_utiles))}`);
  console.log(`  dudosas=${JSON.stringify(lista(guardado.refs_dudosas))}`);
  console.log(`  sin_confirmar=${JSON.stringify(lista(guardado.sin_confirmar))}\n`);

  const { veredicto, error: err } = await revalidar.revalidar(clasificado, matches);
  if (err || !veredicto) {
    console.log(`VEREDICTO DE AHORA: fallo -> ${err || "sin veredicto"}`);
    process.exit(2);
  }
  console.log("VEREDICTO DE AHORA (prompt desplegado):");
  console.log(`  utiles=${JSON.stringify(lista(veredicto.refs_utiles))}`);
  console.log(`  dudosas=${JSON.stringify(lista(veredicto.refs_dudosas))}`);
  console.log(`  sin_confirmar=${JSON.stringify(lista(veredicto.sin_confirmar))}`);
  console.log(`  por_que: ${veredicto.por_que}`);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
