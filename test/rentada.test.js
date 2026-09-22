// "Que este rentando" es literal (Juan, 2026-09-22): "cuando no se tenga
// claridad si esta alquilado o no, callar para no incomodar a los colegas".
//
// El caso: "APTO, CASA O LOCAL para inversion que este rentando entre 6 a 7
// millones ... Laureles" recibio por DM la 9780079, la 10129664 y la 9921137,
// y ninguna ficha dice si esta arrendada. Los pedidos de abajo son los 7 del
// ultimo mes que nombran la renta (medido 2026-09-22): tres la EXIGEN y cuatro
// solo la PERMITEN ("puede estar arrendado", "arrendada o desocupada").

const { test } = require("node:test");
const assert = require("node:assert");
const { exigeRentada, estaRentada } = require("../src/groups/rentada");

const venta = (texto) => ({ operacion: "venta", mensaje: { texto } });

test("los pedidos reales que EXIGEN renta activa", () => {
  for (const t of [
    "PEDIDO: APTO , CASA O LOCAL para inversiòn que este rentando entre 6 a 7 millones en los sectores laureles",
    "Casa, Apartamento o local, que esté bien ubicado, lo más importante es que rente muy bien. Ojo: no quiere desocupado, quiere que ya esté rentando.",
    "Busca: Edificio para inversión 💰 Preferiblemente: Que tenga apartamentos y/o locales actualmente rentando",
    "Apto en Laureles con inquilino, que produzca renta",
    "Local arrendado actualmente en $4.000.000",
  ]) {
    assert.strictEqual(exigeRentada(venta(t)), true, t);
  }
});

test("los que solo la PERMITEN no la exigen", () => {
  for (const t of [
    "busco apto en Belén la palma o poblado partes bajas puede estar arrendado presupuesto: 850MM",
    "✅2 o 3 habitaciones ✅buena vista ✅puede estar alquilado ✅💰290.000.000",
    "Requiero bodegas para inversión (arrendada o desocupada), una $2.000 a $3.000 MILLONES",
    "Apto para inversión que se pueda arrendar mínimo en $1.500.000",
    "Apartaestudio para rentas cortas en Laureles",
    "Busco apartamento en Laureles 3 alcobas",
  ]) {
    assert.strictEqual(exigeRentada(venta(t)), false, t);
  }
});

test("solo aplica a pedidos de venta", () => {
  assert.strictEqual(exigeRentada({ operacion: "arriendo", mensaje: { texto: "que este rentando" } }), false);
});

test("lee el texto guardado cuando no viene el mensaje (recalcular)", () => {
  assert.strictEqual(exigeRentada({ operacion: "venta", texto_original: "que ya esté rentando" }), true);
});

test("la ficha que dice que renta hoy", () => {
  assert.strictEqual(estaRentada({ descripcion: "📈 Propiedad actualmente rentando por Airbnb 💵 Flujo de ingresos inmediato" }), true);
  assert.strictEqual(estaRentada({ descripcion: "Se vende con inquilino, contrato vigente" }), true);
  assert.strictEqual(estaRentada({ descripcion: "Actualmente arrendado en $3.200.000" }), true);
});

test("la ficha que dice que esta vacia", () => {
  assert.strictEqual(estaRentada({ titulo: "Apartamento en Venta en El Poblado - Para Estrenar" }), false);
  assert.strictEqual(estaRentada({ descripcion: "Inmueble desocupado, entrega inmediata" }), false);
});

test("la ficha que no dice nada es null, no false", () => {
  assert.strictEqual(estaRentada({ titulo: "Apartamento en Venta Laureles Cerca al Primer Parque", descripcion: "4 alcobas, balcón" }), null);
  // "para rentas cortas" es lo que PERMITE, no lo que pasa hoy.
  assert.strictEqual(estaRentada({ titulo: "Apartaloft en La América para rentas cortas" }), null);
  assert.strictEqual(estaRentada(null), null);
});
