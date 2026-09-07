const { test } = require("node:test");
const assert = require("node:assert");
const { COLUMNAS_NUEVAS } = require("../src/data/group-signals");

test("las columnas nuevas entran en la lista de reintento", () => {
  // Si el insert falla porque la migracion no corrio, group-signals reintenta
  // SIN estas columnas. Fuera de la lista, una senal se perderia entera en vez
  // de guardarse sin el dato nuevo — y una senal guardada a medias vale mucho
  // mas que una senal perdida.
  assert.ok(COLUMNAS_NUEVAS.includes("amoblado"));
  assert.ok(COLUMNAS_NUEVAS.includes("periodo"));
});
