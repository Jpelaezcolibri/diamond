// Una propiedad cuya "zona" es un MUNICIPIO no puede ser invisible.
//
// EL CASO REAL (Esteban Higuita, 2026-09-05, 11:26). Pidió "Apartamento
// *Envigado y Sabaneta* · 3 habitaciones + 2 baños · Área 80m2 en adelante ·
// Presupuesto $750.000.000 Max". El clasificador leyó las dos zonas bien
// (`zonas: ["Envigado","Sabaneta"]`), pero de inventario propio solo salieron
// Envigado y El Poblado — ninguna de Sabaneta.
//
// LA CAUSA. La ref 9776631 ("Venta Apartamento en Sabaneta en Zona Plana",
// 77 m², 3 alcobas, 2 baños, $470.000.000, disponible) tiene la columna `zona`
// VACÍA: Sabaneta está en `ciudad`. Con la zona vacía, zonaCoincide da false,
// zonaVecina da false, y ubicacionCoincide cae al `if (!ciudadCoincide) return
// null` — el pedido no nombraba ciudad, así que la propiedad se descartaba
// ENTERA, antes de que nadie evaluara área, precio ni alcobas.
//
// Con la zona cargada, esa misma propiedad puntúa 95: habría sido la segunda
// mejor opción del pedido.
//
// POR QUÉ PASA SEGUIDO. En el Valle de Aburrá el colega nombra municipios
// —Sabaneta, Envigado, Itagüí, La Estrella— como si fueran barrios, y Wasi los
// guarda en `ciudad` dejando `zona` vacía. Medido el 2026-09-05: 17 de 122
// propiedades (13,9 %) tienen `zona` vacía, y 3 de ellas quedaban invisibles
// para cualquier pedido que nombrara su municipio (~$3.300 millones de
// inventario).
//
// EL ARREGLO ES ANGOSTO A PROPÓSITO: la ciudad se mira SOLO cuando `zona` está
// vacía, y solo contra las zonas que el pedido nombró. Pedir "El Poblado" no
// puede empezar a traer todo lo de Medellín.
const { test } = require("node:test");
const assert = require("node:assert");
const match = require("../src/groups/match");

const PEDIDO = {
  tipo: "apartamento", operacion: "venta", zona: "Envigado", zonas: ["Envigado", "Sabaneta"],
  ciudad: null, habitaciones: 3, banos: 2, area_min: 80, precio_max: 750000000,
};
const REF_9776631 = {
  ref: "9776631", tipo: "Apartamento", operacion: "Venta", zona: "", ciudad: "Sabaneta",
  titulo: "Venta Apartamento en Sabaneta en Zona Plana", area: "77m2", precio: "$470.000.000",
  habitaciones: 3, banos: 2, disponible: true, fuente: "diamond",
};

test("zona vacía + ciudad que ES la zona pedida: coincide", () => {
  assert.strictEqual(match.zonaCoincide(REF_9776631, PEDIDO), true);
});

test("el caso de Esteban: la propiedad deja de ser invisible", () => {
  const ev = match.evaluarCandidata(REF_9776631, PEDIDO, "diamond");
  assert.ok(ev, "sigue descartándose entera antes de evaluar nada");
  assert.ok(ev.puntaje > 80, `puntaje demasiado bajo: ${ev.puntaje}`);
});

test("se gradúa como zona EXACTA, no como 'fuera de la zona pedida'", () => {
  const u = match.ubicacionCoincide(REF_9776631, PEDIDO);
  assert.ok(u);
  assert.strictEqual(u.grado, "exacta");
});

test("pedir un barrio NO trae toda la ciudad", () => {
  // La trampa del arreglo: si la ciudad valiera siempre, quien pide "El
  // Poblado" recibiría cualquier cosa de Medellín.
  const enMedellin = { ...REF_9776631, ref: "x", zona: "", ciudad: "Medellín" };
  const pidePoblado = { ...PEDIDO, zona: "El Poblado", zonas: ["El Poblado"] };
  assert.strictEqual(match.zonaCoincide(enMedellin, pidePoblado), false);
});

test("con la zona cargada, la ciudad no se mira: nada cambia", () => {
  // Una propiedad de Itagüí con zona propia no puede colarse en un pedido de
  // Sabaneta solo porque su ciudad diga otra cosa.
  const conZona = { ...REF_9776631, zona: "Santa María", ciudad: "Sabaneta" };
  const pideOtra = { ...PEDIDO, zona: "Laureles", zonas: ["Laureles"] };
  assert.strictEqual(match.zonaCoincide(conZona, pideOtra), false);
});

test("la propiedad que ya funcionaba sigue igual", () => {
  const envigado = {
    ref: "10077063", tipo: "Apartamento", operacion: "Venta", zona: "Envigado", ciudad: "Envigado",
    titulo: "Vendo apartamento Envigado", area: "83m2", precio: "$450.000.000",
    habitaciones: 3, banos: 2, disponible: true, fuente: "diamond",
  };
  assert.strictEqual(match.zonaCoincide(envigado, PEDIDO), true);
  const ev = match.evaluarCandidata(envigado, PEDIDO, "diamond");
  assert.ok(ev && ev.puntaje >= 95, `cambió el puntaje de la que ya salía: ${ev && ev.puntaje}`);
});

test("sin ciudad tampoco inventa una coincidencia", () => {
  const huerfana = { ...REF_9776631, zona: "", ciudad: "" };
  assert.strictEqual(match.zonaCoincide(huerfana, PEDIDO), false);
});

test("la razón que lee la asesora dice la ubicación, no queda vacía", () => {
  const u = match.ubicacionCoincide(REF_9776631, PEDIDO);
  assert.strictEqual(u.razon, "Zona: Sabaneta", "quedaba 'Zona: ' a secas");
});

test("el match viaja con la ubicación, para que la ficha del colega la muestre", () => {
  // Sin esto la ficha salía "Ref 9776631 · Venta ·" sin decir dónde queda, y
  // el desvío de zona (redactar.desvios) no tenía contra qué comparar.
  const ev = match.evaluarCandidata(REF_9776631, PEDIDO, "diamond");
  assert.strictEqual(ev.zona, "Sabaneta");
});
