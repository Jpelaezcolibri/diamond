#!/usr/bin/env node
// Golden set del piso: corre el clasificador REAL contra frases reales de los
// grupos y comprueba la banda que extrae.
//
//   railway run --service diamond node scripts/piso-golden.js
//
// Existe porque el riesgo del piso no es el codigo (eso lo fijan los tests de
// test/group-match-piso.test.js) sino la LECTURA del pedido: una banda leida
// como piso exacto borra propiedades que el colega si acepta. Juan, 2026-09-18:
// "si dice un piso menos a 10, que no deje de mostrar un piso nueve".
//
// Gasta centavos. No toca la base ni le escribe a nadie.

const CLAVE = process.env.ANTHROPIC_API_KEY;
const { classify } = require("../src/groups/classify");

// Frases reales, copiadas de group_signals (1-ago al 18-sep), con la banda que
// tienen que producir. `null` = da igual lo que salga en ese campo.
const CASOS = [
  ["Busco apartamento 👉 Laureles 👉 Fátima 👉 2 habitaciones 👉 Sólo hasta 3° piso 👉 Precio $400 Millones", { piso_max: 3, piso_min: 0 }],
  ["Busco apartamento moderno en Sabaneta o Suramérica: >90 mts. 3 habitaciones Nivel de piso máximo 7 Balcón amplio", { piso_max: 7, piso_min: 0 }],
  ["Busco Apartamento en Venta. Solo en Sabaneta ✅ 3 alcobas ✅ 2 baños ✅ Sin ascensor máximo segundo piso ✅ hasta 380 millones", { piso_max: 2, piso_min: 0 }],
  ["Busco apto en Envigado 3 alcobas, del piso 6 hacia arriba, presupuesto 700 millones", { piso_max: 0, piso_min: 6 }],
  ["Apartamento de 70m2 3 alcobas NO PONIENTE BALCÓN AMPLIO Piso 5 en adelante Es para inversión, hasta 450 millones", { piso_max: 0, piso_min: 5 }],
  ["Busco apartamento en Belén, 2 alcobas, 1 parqueadero cubierto 🏢 Unidad cerrada 🛗 Piso 2 al 11. Obligatorio con ascensor. 350 millones", { piso_max: 11, piso_min: 2 }],
  ["BUSCO APARTAMENTO EN POBLADO DE ENTRE UN 4 A UN PISO 8, 3 habitaciones, hasta 900 millones", { piso_max: 8, piso_min: 4 }],
  ["Busco apto para persona adulta mayor: 70 mts. 2 - 3 habitaciones Piso 1 ó 2 Parqueadero y cuarto útil, Laureles, 400 millones", { piso_max: 2, piso_min: 1 }],
  ["Busco apartamento en Envigado, menos del piso 10, 3 alcobas, hasta 600 millones", { piso_max: 9, piso_min: 0 }],
  ["Busco apartamento en Laureles 👉🏻 2 o 3 alcobas 👉🏻 ojalá piso 1 👉🏻 Presupuesto: $600 millones", { piso_max: 0, piso_min: 0 }],
  ["Busco casa en Envigado * 3 baños en adelante * Máximo 2 pisos * Área 160m2 en adelante, 1.200 millones", { piso_max: 0, piso_min: 0 }],
  ["BUSCO APARTAMENTO PISO ALTO EN EL POBLADO PARTE ALTA, 3 alcobas, hasta 1.500 millones", { piso_min: 4, piso_max: 0 }],
];

(async () => {
  if (!CLAVE) {
    console.error("Sin ANTHROPIC_API_KEY. Corré con: railway run --service diamond node scripts/piso-golden.js");
    process.exit(1);
  }
  const mensajes = CASOS.map(([texto], i) => ({ id: `piso-${i}`, autor: "Colega", texto }));
  const { clasificados, lotesFallidos } = await classify(mensajes, { reintentos: [] });
  if (lotesFallidos) throw new Error("el clasificador fallo");

  let ok = 0;
  for (let i = 0; i < CASOS.length; i++) {
    const [texto, esperado] = CASOS[i];
    const c = clasificados.find((x) => x.id === `piso-${i}`) || {};
    const fallos = Object.entries(esperado)
      .filter(([campo, valor]) => valor !== null && Number(c[campo] || 0) !== valor)
      .map(([campo, valor]) => `${campo}: esperaba ${valor}, dio ${c[campo]}`);
    if (!fallos.length) ok++;
    console.log(`${fallos.length ? "✗" : "✓"} ${texto.slice(0, 62)}…`);
    console.log(`    piso_min=${c.piso_min} piso_max=${c.piso_max}${fallos.length ? `  ← ${fallos.join(" · ")}` : ""}`);
  }
  console.log(`\n${ok}/${CASOS.length}`);
  process.exit(ok === CASOS.length ? 0 : 1);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
