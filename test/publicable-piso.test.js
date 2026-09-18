// La otra mitad del piso literal: lo que la ficha no dice, no sale solo.
//
// 46 de los 90 apartamentos del inventario no dicen en que piso estan
// (medido 2026-09-18), y 255 de cada 1.000 pedidos exigen piso. Esas fichas
// siguen llegando al panel y al aviso de la asesora — una persona puede
// llamar y preguntarlo. Lo que no pueden es salirle solas a un colega.

const { test } = require("node:test");
const assert = require("node:assert");
const publicable = require("../src/groups/publicable");

function matchBueno(extra = {}) {
  return {
    fuente: "diamond",
    ref: "AP004",
    titulo: "Apartamento en Venta Envigado - Cerca al Metro",
    zona: "Centro, Envigado",
    precio: "$395.000.000",
    operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/apartamento-en-venta-envigado-ap004",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado-centro/9744456",
    habitaciones: 2,
    area: "62m2",
    puntaje: 88,
    ubicacion: "exacta",
    razones: ["Zona: Centro, Envigado"],
    ...extra,
  };
}

test("pidio piso y la ficha no lo dice: no sale sola", () => {
  const v = publicable.esPublicable(matchBueno({ piso_sin_confirmar: true }));
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivos.includes("piso_sin_confirmar"), `motivos: ${v.motivos.join(",")}`);
});

test("con el piso leido de la ficha, sale normal", () => {
  const v = publicable.esPublicable(matchBueno({ piso_sin_confirmar: false, piso: 3 }));
  assert.strictEqual(v.ok, true, `motivos: ${v.motivos.join(",")}`);
});

test("piso_sin_confirmar se le explica a la asesora en castellano", () => {
  const texto = publicable.explicarMotivosSeguro(["piso_sin_confirmar"]);
  assert.ok(texto, "sin traduccion, quien lo lea se inventa la razon");
  assert.match(texto, /piso/i);
});

test("piso_sin_confirmar lo puede resolver una persona: la propiedad sigue siendo ofrecible", () => {
  const { soloPublicacion, ofrecible } = publicable.clasificarMotivos(["piso_sin_confirmar"]);
  assert.deepStrictEqual(soloPublicacion, ["piso_sin_confirmar"]);
  assert.strictEqual(ofrecible, true);
});
