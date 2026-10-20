// Una propiedad de asesor tiene como `link` la ficha de la landing. El radar
// exige linkWasi no vacio y un link que no sea de Wasi: con withLandingLink
// la ficha de la landing pasa las dos compuertas.
const { test } = require("node:test");
const assert = require("node:assert");
const { withLandingLink } = require("../src/data/properties");
const publicable = require("../src/groups/publicable");

test("la ficha de la landing de un asesor no cae en sin_link_wasi ni link_ajeno", () => {
  const p = withLandingLink({
    ref: "D1001", titulo: "Casa en venta en Belén", operacion: "Venta", precio: "$450.000.000", zona: "Belén", area: "120m2",
    link: "https://diamondinmobiliaria.com/propiedades/casa-en-venta-en-belen-d1001", disponible: true,
  }, "https://diamondinmobiliaria.com");
  const r = publicable.esPublicable({ ...p, fuente: "diamond", puntaje: 95 }, { syncFresco: true });
  assert.ok(!r.motivos.includes("sin_link_wasi"), JSON.stringify(r.motivos));
  assert.ok(!r.motivos.includes("link_ajeno"), JSON.stringify(r.motivos));
});
