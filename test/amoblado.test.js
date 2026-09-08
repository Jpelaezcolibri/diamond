const { test } = require("node:test");
const assert = require("node:assert");
const { esAmoblada } = require("../src/groups/amoblado");

// Las dos fichas REALES del inventario de produccion (verificadas por REST el
// 2026-09-07). Importan porque prueban el hallazgo que motivo este modulo:
// Wasi pone "Amoblado" en el TITULO y no en las caracteristicas. La ficha de
// la 10319436 trae 43 caracteristicas ("Sauna", "Turco", "Piscina"...) y
// ninguna dice amoblado.
test("la marca vive en el titulo, no en las caracteristicas", () => {
  const don_quijote = {
    titulo: "Apartamento Amoblado en Arriendo en Don Quijote, Medellín",
    caracteristicas: "Admite mascotas, Agua, Armarios empotrados, Ascensor, Cocina integral",
  };
  assert.strictEqual(esAmoblada(don_quijote), true);
});

test("una propiedad de venta cualquiera es null, NO false", () => {
  // La diferencia decide el carril: `false` descarta la candidata ante un
  // pedido de amoblado; `null` la deja pasar marcada sin_confirmar y el
  // pedido llega igual a la asesora. Colapsarlos pierde pedidos en silencio.
  const venta = {
    titulo: "Apartamento en Venta en Los Colores, Medellín - 2 Alcobas",
    caracteristicas: "Balcón, Ascensor",
  };
  assert.strictEqual(esAmoblada(venta), null);
});

test("'sin amoblar' es false, y gana sobre el patron positivo", () => {
  // El orden importa: "no amoblado" contiene "amoblad". Si el patron positivo
  // se evalua primero, una propiedad explicitamente vacia se ofrece como
  // amoblada — el error exacto que este modulo existe para no cometer.
  assert.strictEqual(esAmoblada({ titulo: "Apartamento sin amoblar en Envigado" }), false);
  assert.strictEqual(esAmoblada({ titulo: "Apto NO amoblado, Sabaneta" }), false);
});

test("tambien lee las caracteristicas, por si Wasi empieza a marcarlo", () => {
  assert.strictEqual(esAmoblada({ titulo: "Apto en Laureles", caracteristicas: "Amoblado, Balcón" }), true);
});

test("sin datos es null, nunca revienta", () => {
  assert.strictEqual(esAmoblada(null), null);
  assert.strictEqual(esAmoblada({}), null);
  assert.strictEqual(esAmoblada({ titulo: "", caracteristicas: null }), null);
});

test("defects verificados por reviewer 2026-09-07: word boundary y amueblad", () => {
  // Defecto 1: "no\s+amoblad" sin frontera de palabra confunde "moderno" +
  // "amoblado" con negacion. Dos casos de fraseologia ordinaria colombiana.
  assert.strictEqual(esAmoblada({ titulo: "Apartamento moderno amoblado en Laureles" }), true);
  assert.strictEqual(esAmoblada({ titulo: "Conjunto urbano amoblado cerca al metro" }), true);

  // Defecto 2: "PATRON_NO" no cubre la negacion de "amueblad". Al no encontrar
  // la negacion, PATRON_SI acierta y devuelve true (lo opuesto de lo pedido).
  assert.strictEqual(esAmoblada({ titulo: "Apartamento NO amueblado en Sabaneta" }), false);
  assert.strictEqual(esAmoblada({ titulo: "Apartamento sin amueblar en Envigado" }), false);
});

// IMPORTANT 2 del review de fin de rama (2026-09-07): PATRON_SI no tenia
// frontera de palabra, asi que matcheaba como SUBCADENA de cualquier palabra
// que contuviera "amoblad" -- "Desamoblado" (des-AMOBLAD-o) daba `true`,
// justo lo contrario de lo que dice el titulo. Verificado ANTES del fix:
// esAmoblada({titulo:"Apartamento Desamoblado en Arriendo en Laureles"})
// devolvia true.
test("'Desamoblado' NO es 'amoblado': el prefijo pegado no matchea el patron positivo", () => {
  const desamoblado = { titulo: "Apartamento Desamoblado en Arriendo en Laureles" };
  // PATRON_NO tampoco lo cubre (no es "sin amoblar" ni "no amoblado", es un
  // prefijo pegado a la palabra) -- el resultado correcto es null, el tercer
  // estado: no sabemos con certeza que dice el titulo, y `false` seria
  // afirmar una negacion que el patron de negacion no reconoce.
  assert.strictEqual(esAmoblada(desamoblado), null, "antes del fix esto daba true");
});

test("'semiamoblado' pasa de true a null -- el tercer estado correcto (no confirmado), no una afirmacion", () => {
  const semi = { titulo: "Apartamento semiamoblado en Belen" };
  assert.strictEqual(esAmoblada(semi), null);
});
