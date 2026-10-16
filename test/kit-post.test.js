const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { postGrupo } = require("../src/groups/redactar");

let previo;
beforeEach(() => { previo = process.env.CONTACT_WHATSAPP_NUMBER; process.env.CONTACT_WHATSAPP_NUMBER = "573044653609"; });
afterEach(() => { if (previo === undefined) delete process.env.CONTACT_WHATSAPP_NUMBER; else process.env.CONTACT_WHATSAPP_NUMBER = previo; });

function prop(extra = {}) {
  return {
    ref: "10077063",
    titulo: "Apartamento en La Frontera",
    zona: "Envigado",
    operacion: "Venta",
    area: "85m2",
    habitaciones: 3,
    precio: "$480.000.000",
    banos: 2,
    garajes: 1,
    estrato: 4,
    administracion: "$350.000",
    caracteristicas: "Piscina, Gimnasio, Porteria 24 h",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10077063?shared=whatsapp",
    ...extra,
  };
}

test("post completo: titulo, identidad, medidas, detalles, comision y los dos links", () => {
  const t = postGrupo(prop());
  const lineas = t.split("\n");
  assert.strictEqual(lineas[0], "Apartamento en La Frontera");
  assert.strictEqual(lineas[1], "Ref 10077063 · Venta · Envigado");
  assert.strictEqual(lineas[2], "85 m² · 3 alcobas · $480.000.000");
  assert.match(t, /administración \$350\.000/);
  assert.match(t, /Piscina · Gimnasio · Porteria 24 h/);
  assert.match(t, /Comparto comisión con colegas/);
  assert.match(t, /Fotos y ficha: https:\/\/info\.wasi\.co\/apartamento-venta-envigado\/10077063/);
  const esperado = `https://wa.me/573044653609?text=${encodeURIComponent("Hola, vi en un grupo la Ref 10077063")}`;
  assert.ok(t.includes(`Info o visita con Sofi: ${esperado}`));
});

test("sin comision no aparece la linea", () => {
  assert.doesNotMatch(postGrupo(prop(), { comision: false }), /comisión/);
});

test("lo que no esta cargado no aparece", () => {
  const t = postGrupo(prop({ banos: null, garajes: null, estrato: null, administracion: null, caracteristicas: "" }));
  assert.doesNotMatch(t, /baño|garaje|estrato|administración/);
  assert.doesNotMatch(t, /undefined|null|NaN/);
});

test("sin numero oficial de contacto se omite la linea de Sofi", () => {
  delete process.env.CONTACT_WHATSAPP_NUMBER;
  const t = postGrupo(prop());
  assert.doesNotMatch(t, /Sofi/);
  assert.match(t, /Fotos y ficha:/);
});

test("nunca lleva el indice '1)' ni sangria de la ficha del DM", () => {
  const t = postGrupo(prop());
  assert.doesNotMatch(t, /^1\)/m);
  assert.doesNotMatch(t, /^ {3}/m);
});
