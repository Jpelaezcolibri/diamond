// La otra mitad de los parqueaderos literales: lo que no se puede verificar
// no sale solo.
//
// El incumplimiento CONOCIDO (tiene 1, pidieron 2) ya no llega hasta aca:
// match.js lo descarta (ver test/group-match-garajes.test.js). Lo que llega es
// la ficha SIN el dato, que puede tener el parqueadero y nadie lo cargo en
// Wasi. Esa entra al panel y al aviso de la asesora, pero no le sale sola a un
// colega — mismo trato que `amoblado_sin_confirmar`.

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

test("pidio parqueadero y la ficha no lo trae: no sale sola", () => {
  const v = publicable.esPublicable(matchBueno({ garajes_sin_dato: true }));
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivos.includes("garajes_sin_dato"), `motivos: ${v.motivos.join(",")}`);
});

test("con el dato cargado no pasa nada", () => {
  const v = publicable.esPublicable(matchBueno({ garajes_sin_dato: false, garajes: 2 }));
  assert.strictEqual(v.ok, true, `motivos: ${v.motivos.join(",")}`);
});

test("garajes_sin_dato se le explica a la asesora en castellano", () => {
  const texto = publicable.explicarMotivosSeguro(["garajes_sin_dato"]);
  assert.ok(texto, "sin traduccion, quien lo lea se inventa la razon");
  assert.match(texto, /parqueader|garaj/i);
});

test("garajes_sin_dato es de los que una persona SI puede resolver", () => {
  const { soloPublicacion, ofrecible } = publicable.clasificarMotivos(["garajes_sin_dato"]);
  assert.deepStrictEqual(soloPublicacion, ["garajes_sin_dato"]);
  assert.strictEqual(ofrecible, true, "la asesora tiene que poder ofrecerla igual");
});
