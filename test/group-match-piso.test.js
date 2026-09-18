// El piso es literal (Juan, 2026-09-18): "quiero que seas muy estricto con
// los pedidos que exigen piso".
//
// LOS TRES ESTADOS, como en amoblado y en garajes:
//   · la ficha dice el piso y NO cumple -> descarta aca.
//   · la ficha dice el piso y cumple    -> pasa y suma.
//   · la ficha no lo dice               -> pasa marcada `piso_sin_confirmar`,
//     y publicable.js impide que salga sola. Hoy son 46 de los 90
//     apartamentos del inventario.
//
// SOLO APLICA A APARTAMENTOS. Una casa no esta "en un piso": el pedido que
// dice "casa de un piso" habla de plantas, que es otra cosa y no se extrae
// (ver src/groups/piso.js). Aplicar la exigencia a las casas las borraria a
// todas por un dato que su ficha nunca va a traer.

const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata } = require("../src/groups/match");

const pedido = {
  operacion: "venta", tipo: "apartamento", zona: "El Poblado", zonas: ["El Poblado"],
  zonas_excluidas: [], ciudad: "", precio_max: 800000000, precio_min: 0,
  habitaciones: 2, area_min: 0, banos: 0, garajes: 0, estrato: 0,
  amoblado: "", periodo: "", piso_max: 0, piso_min: 0,
};

function apto(extra = {}) {
  return {
    ref: "AP200", titulo: "Apartamento en Venta El Poblado", tipo: "Apartamento",
    operacion: "Venta", precio: "$700.000.000", area: "90m2", habitaciones: 3,
    zona: "El Poblado", ciudad: "Medellín", descripcion: "", ...extra,
  };
}

test("pide maximo piso 3 y el apartamento esta en el 19 -> no es candidato", () => {
  const m = evaluarCandidata(apto({ descripcion: "Piso 19 con vista" }), { ...pedido, piso_max: 3 }, "diamond");
  assert.strictEqual(m, null);
});

test("pide maximo piso 3 y el apartamento esta en el 2 -> pasa y lo dice", () => {
  const m = evaluarCandidata(apto({ descripcion: "Piso 2, sin ascensor" }), { ...pedido, piso_max: 3 }, "diamond");
  assert.ok(m, "tiene que pasar");
  assert.strictEqual(m.piso, 2);
  assert.strictEqual(m.piso_sin_confirmar, false);
  assert.ok(m.razones.some((r) => /piso 2/i.test(r)), `razones: ${m.razones.join(" | ")}`);
});

test("pide piso alto (minimo 4) y el apartamento esta en el 2 -> no es candidato", () => {
  const m = evaluarCandidata(apto({ descripcion: "Piso 2" }), { ...pedido, piso_min: 4 }, "diamond");
  assert.strictEqual(m, null);
});

test("pide maximo piso 2 y la ficha solo dice 'piso alto' -> no es candidato", () => {
  const m = evaluarCandidata(apto({ descripcion: "Vive en piso alto, con vista abierta" }), { ...pedido, piso_max: 2 }, "diamond");
  assert.strictEqual(m, null, "'alto' contradice un techo de 2");
});

test("pide piso alto y la ficha dice 'piso alto' -> pasa confirmado", () => {
  const m = evaluarCandidata(apto({ descripcion: "Vive en piso alto" }), { ...pedido, piso_min: 4 }, "diamond");
  assert.ok(m);
  assert.strictEqual(m.piso_sin_confirmar, false);
});

test("pide piso y la ficha no lo dice -> pasa marcada, no sale sola", () => {
  const m = evaluarCandidata(apto({ descripcion: "Excelente ubicación, cocina integral" }), { ...pedido, piso_max: 3 }, "diamond");
  assert.ok(m, "sin dato no se descarta: la asesora tiene que poder verla");
  assert.strictEqual(m.piso_sin_confirmar, true);
});

test("el pedido no menciona el piso -> no marca nada aunque la ficha no lo diga", () => {
  const m = evaluarCandidata(apto(), pedido, "diamond");
  assert.ok(m);
  assert.strictEqual(m.piso_sin_confirmar, false);
});

test("una CASA no se descarta por un pedido que exige piso", () => {
  const casa = apto({ ref: "CA100", tipo: "Casa", titulo: "Casa en Venta El Poblado", descripcion: "Casa de dos pisos" });
  const m = evaluarCandidata(casa, { ...pedido, tipo: null, piso_max: 2 }, "diamond");
  assert.ok(m, "una casa no esta 'en un piso': la exigencia no le aplica");
  assert.strictEqual(m.piso_sin_confirmar, false);
});

test("el caso 10012722: pide maximo segundo piso y el del 19 se queda afuera", () => {
  const real = apto({
    ref: "10012722",
    titulo: "VENDO APARTAMENTO CIUDADELA DEL VALLE PISO ALTO CON VISTA",
    descripcion: "Apartamento moderno. * Piso 19 con vista * Unidad con dos piscinas",
    precio: "$390.000.000",
  });
  assert.strictEqual(evaluarCandidata(real, { ...pedido, piso_max: 2 }, "diamond"), null);
});

// UNA BANDA NO ES UN PISO EXACTO (Juan, 2026-09-18): "si dice un piso menos a
// 10, que no deje de mostrar un piso nueve porque cree que tiene que ser piso
// 10". El daño de esta regla es el contrario al de la zona: pasarse de
// estricto borra propiedades que el colega SI acepta.
test("pide 'menos del piso 10' y el apartamento esta en el 9 -> sirve", () => {
  const m = evaluarCandidata(apto({ descripcion: "Piso 9 con vista" }), { ...pedido, piso_max: 10 }, "diamond");
  assert.ok(m, "el 9 esta por debajo del techo de 10: tiene que pasar");
});

test("pide 'del piso 6 hacia arriba' y el apartamento esta en el 14 -> sirve", () => {
  const m = evaluarCandidata(apto({ descripcion: "Piso 14" }), { ...pedido, piso_min: 6 }, "diamond");
  assert.ok(m);
});

test("pide un rango 'piso 2 al 11' -> entra el 9 y se cae el 15", () => {
  const rango = { ...pedido, piso_min: 2, piso_max: 11 };
  assert.ok(evaluarCandidata(apto({ descripcion: "Piso 9" }), rango, "diamond"), "el 9 esta dentro");
  assert.strictEqual(evaluarCandidata(apto({ descripcion: "Piso 15" }), rango, "diamond"), null, "el 15 esta fuera");
});

test("el techo incluye el numero que dijo el colega: pide hasta 3 y el 3 sirve", () => {
  const m = evaluarCandidata(apto({ descripcion: "Piso 3" }), { ...pedido, piso_max: 3 }, "diamond");
  assert.ok(m, "'hasta el 3' incluye al 3");
});
