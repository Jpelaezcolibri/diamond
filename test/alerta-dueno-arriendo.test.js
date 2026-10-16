const { test } = require("node:test");
const assert = require("node:assert");
const { buildAdvisorAlert, fichaInmuebleOfrecido } = require("../src/notifications/advisor");

const org = { id: "org-1", name: "Diamond" };

function lead(extra = {}) {
  return { id: "l1", phone: "573001112233", nombre: "Marta Restrepo", score: 40, intencion: "consignar_arriendo", ...extra };
}

test("renta corta: encabezado y ficha con RNT y edificio", () => {
  const txt = buildAdvisorAlert(org, lead({
    inmueble_ofrecido: { tipo: "apartamento", zona: "Provenza, El Poblado", habitaciones: 2, amoblado: "si", canon: "$280.000 por noche", periodo: "corta", rnt: "en tramite", ph_permite: "si" },
  }), "dueno quiere arrendar", null, "arriendo", null, null);
  assert.match(txt, /Dueño · renta corta/);
  assert.match(txt, /Inmueble: apartamento amoblado/);
  assert.match(txt, /Zona: Provenza, El Poblado/);
  assert.match(txt, /Espera: \$280\.000 por noche/);
  assert.match(txt, /RNT: en tramite/);
  assert.match(txt, /Edificio permite renta corta: si/);
  assert.doesNotMatch(txt, /Propiedad de interes/);
});

test("arriendo mensual: encabezado propio y sin lineas de renta corta", () => {
  const txt = buildAdvisorAlert(org, lead({ inmueble_ofrecido: { tipo: "casa", zona: "Envigado", periodo: "mensual" } }), "m", null, "arriendo", null, null);
  assert.match(txt, /Dueño · arriendo mensual/);
  assert.doesNotMatch(txt, /RNT/);
});

test("sin ficha todavia: encabezado generico de dueno", () => {
  const txt = buildAdvisorAlert(org, lead(), "m", null, "arriendo", null, null);
  assert.match(txt, /Dueño · quiere arrendar su propiedad/);
});

test("fichaInmuebleOfrecido omite lo que no esta", () => {
  assert.deepStrictEqual(fichaInmuebleOfrecido({ zona: "Sabaneta" }), ["Zona: Sabaneta"]);
  assert.deepStrictEqual(fichaInmuebleOfrecido(null), []);
});
