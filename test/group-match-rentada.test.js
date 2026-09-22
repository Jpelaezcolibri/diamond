// La renta activa en el motor y en la compuerta (Juan, 2026-09-22). Los tres
// estados, como amoblado y piso:
//   · el pedido la exige y la ficha dice que esta vacia -> descarta aca.
//   · la ficha dice que renta hoy                       -> pasa y lo dice.
//   · la ficha no dice nada                             -> pasa marcada
//     `rentada_sin_confirmar`, y publicable.js la calla.

const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata } = require("../src/groups/match");
const publicable = require("../src/groups/publicable");

const pedido = {
  operacion: "venta", tipo: "apartamento", zona: "Laureles", zonas: ["Laureles"],
  zonas_excluidas: [], ciudad: "", precio_max: 1000000000, precio_min: 0,
  habitaciones: 0, area_min: 0, banos: 0, garajes: 0, estrato: 0,
  amoblado: "", periodo: "", piso_max: 0, piso_min: 0,
  mensaje: { texto: "PEDIDO: APTO para inversiòn que este rentando entre 6 a 7 millones en laureles. presupuesto 1000 millones" },
};

function apto(extra = {}) {
  return {
    ref: "10129664", titulo: "Apartamento en Venta Laureles Cerca al Primer Parque", tipo: "Apartamento",
    operacion: "Venta", precio: "$860.000.000", area: "118m2", habitaciones: 4,
    zona: "Laureles", ciudad: "Medellín", descripcion: "4 alcobas, 3 baños", ...extra,
  };
}

test("exige renta y la ficha no lo dice -> pasa marcada y no sale sola", () => {
  const m = evaluarCandidata(apto(), pedido, "diamond");
  assert.ok(m, "tiene que llegar al panel");
  assert.strictEqual(m.rentada_sin_confirmar, true);
  const v = publicable.esPublicable({ ...m, fuente: "diamond", link: "https://diamondinmobiliaria.com/p/1", linkWasi: "https://info.wasi.co/x/10129664", ubicacion: "exacta", puntaje: 90 });
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivos.includes("rentada_sin_confirmar"), v.motivos.join(","));
});

test("exige renta y la ficha dice para estrenar -> no es candidata", () => {
  assert.strictEqual(evaluarCandidata(apto({ titulo: "Apartamento para estrenar en Laureles" }), pedido, "diamond"), null);
});

test("exige renta y la ficha dice que renta -> pasa confirmada y lo dice", () => {
  const m = evaluarCandidata(apto({ descripcion: "Actualmente arrendado en $6.500.000" }), pedido, "diamond");
  assert.ok(m);
  assert.strictEqual(m.rentada_sin_confirmar, false);
  assert.ok(m.razones.some((r) => /arrendad|rentando/i.test(r)), m.razones.join(" | "));
});

test("el pedido que no exige renta no marca nada", () => {
  const m = evaluarCandidata(apto(), { ...pedido, mensaje: { texto: "apto en Laureles, puede estar arrendado" } }, "diamond");
  assert.ok(m);
  assert.strictEqual(m.rentada_sin_confirmar, false);
});

test("rentada_sin_confirmar solo frena la publicacion, se traduce y se le aclara al colega", () => {
  assert.strictEqual(publicable.clasificarMotivos(["rentada_sin_confirmar"]).ofrecible, true);
  assert.match(publicable.explicarMotivosSeguro(["rentada_sin_confirmar"]), /arrendad|rentand/i);
  assert.match(publicable.aclaracionParaColega(["rentada_sin_confirmar"]), /arrendad|rentand/i);
});
