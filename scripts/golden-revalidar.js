#!/usr/bin/env node
// Corre el golden set del veredicto de Sofi contra el prompt que esta en el
// codigo AHORA y dice si cada caso real sigue saliendo como debe. No envia
// nada ni escribe en la base: lee las señales y llama a la API.
//
//   railway run --service diamond node scripts/golden-revalidar.js
//   railway run --service diamond node scripts/golden-revalidar.js test/golden/otro.json
//
// POR QUE EXISTE (auditoria 2026-09-05, H7). Los tests de test/*.test.js fijan
// FRASES del prompt (`SISTEMA.includes("...")`): no pueden ver que dos frases
// se contradicen, y el 05-sep la suite paso entera con dos ordenes opuestas
// adentro. Lo unico que prueba un prompt es correrlo sobre pedidos reales y
// comparar el veredicto. Este script es eso, repetible.
//
// Es el mismo patron que scripts/diagnostico-revalidar.js (una señal, salida
// para leer); aca son varias y la salida es PASS/FAIL. Sale con codigo 1 si
// algun caso falla, para poder encadenarlo antes de un push.
//
// La clave se captura ANTES de requerir src/: src/config.js corre dotenv con
// `override: true` y pisaria la clave inyectada por `railway run`.
const CLAVE_INYECTADA = process.env.ANTHROPIC_API_KEY;

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const revalidar = require("../src/groups/revalidar");

if (CLAVE_INYECTADA) process.env.ANTHROPIC_API_KEY = CLAVE_INYECTADA;

const archivo = process.argv[2] || path.join(__dirname, "..", "test", "golden", "revalidar-2026-09-05.json");
const golden = JSON.parse(fs.readFileSync(archivo, "utf8"));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const lista = (v) => (Array.isArray(v) ? v.map(String) : []);
const plano = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Mismo armado del clasificado que scripts/diagnostico-revalidar.js: la señal
// guardada trae los campos sueltos, revalidar espera el shape de classify.js.
function clasificadoDe(data) {
  return {
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
}

function evaluar(caso, veredicto) {
  const fallas = [];
  const utiles = lista(veredicto.refs_utiles);
  const dudosas = lista(veredicto.refs_dudosas);
  const sinConfirmar = lista(veredicto.sin_confirmar).map(plano).join(" | ");

  for (const ref of caso.utiles_esperadas || []) {
    if (!utiles.includes(String(ref))) fallas.push(`la ref ${ref} tenia que estar en refs_utiles`);
  }
  for (const ref of caso.nunca_en_dudosas || []) {
    if (dudosas.includes(String(ref))) fallas.push(`la ref ${ref} cayo a refs_dudosas`);
  }
  for (const palabra of caso.sin_confirmar_menciona || []) {
    // "a|b" acepta cualquiera de las dos formas.
    const alguna = palabra.split("|").some((p) => sinConfirmar.includes(plano(p)));
    if (!alguna) fallas.push(`sin_confirmar no menciona "${palabra}" (trae: ${sinConfirmar || "vacio"})`);
  }
  return fallas;
}

(async () => {
  let fallidos = 0;
  console.log(`Golden set: ${archivo}\n${golden.casos.length} casos\n`);

  for (const caso of golden.casos) {
    const { data, error } = await supabase.from("group_signals").select("*").eq("id", caso.id).maybeSingle();
    if (error || !data) {
      fallidos++;
      console.log(`FAIL  ${caso.nombre}\n      no se pudo leer la señal ${caso.id}: ${error ? error.message : "no existe"}\n`);
      continue;
    }
    const { veredicto, error: err } = await revalidar.revalidar(clasificadoDe(data), data.matches || []);
    if (!veredicto) {
      fallidos++;
      console.log(`FAIL  ${caso.nombre}\n      la API no devolvio veredicto: ${err || "sin detalle"}\n`);
      continue;
    }
    const fallas = evaluar(caso, veredicto);
    const estado = fallas.length ? "FAIL" : "PASS";
    if (fallas.length) fallidos++;
    console.log(`${estado}  ${caso.nombre}`);
    console.log(`      utiles=${JSON.stringify(lista(veredicto.refs_utiles))} dudosas=${JSON.stringify(lista(veredicto.refs_dudosas))}`);
    console.log(`      sin_confirmar=${JSON.stringify(lista(veredicto.sin_confirmar))}`);
    // El razonamiento SIEMPRE, tambien en PASS: es lo que dice por que el
    // prompt acerto o fallo, y un PASS con un por_que raro tambien es dato.
    console.log(`      por_que: ${String(veredicto.por_que || "").replace(/\s+/g, " ")}`);
    for (const f of fallas) console.log(`      -> ${f}`);
    console.log("");
  }

  console.log(fallidos ? `${fallidos} de ${golden.casos.length} casos fallan.` : `Los ${golden.casos.length} casos pasan.`);
  process.exit(fallidos ? 1 : 0);
})().catch((e) => {
  console.error("El golden set no pudo correr:", e.message);
  process.exit(2);
});
