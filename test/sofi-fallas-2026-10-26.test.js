// Fallas de Sofi del 2026-10-26 (validacion de agendas):
//  - Juan Felipe pidio "otra parecida" a un pedido de Buenos Aires/Villa
//    Hermosa/Boston/Robledo hasta $270M y Sofi le ofrecio Loma del Indio por
//    $640M y Envigado por $520M.
//  - Simón conto su lote en 8 mensajes y quedo registrado 8 veces.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool } = require("../src/agent/tools");
const properties = require("../src/data/properties");
const allyProperties = require("../src/data/ally-properties");
const busquedaColega = require("../src/agent/busqueda-colega");

const PEDIDO_H87A = {
  id: "sig-h87a",
  texto_original: "BUSCO APARTAMENTO EN VENTA 2 alcobas. Sectores: Buenos Aires, Villa Hermosa, Boston, Robledo. Presupuesto maximo $270.000.000",
  operacion: "venta",
  tipo: "apartamento",
  zona: "Buenos Aires",
  zonas: ["Buenos Aires", "Villa Hermosa", "Boston", "Robledo"],
  ciudad: "Medellín",
  precio_max: 270000000,
  habitaciones: 2,
  garajes: 1,
  banos: 1,
};

function prop(ref, zona, ciudad, precio, extra = {}) {
  return { id: `p-${ref}`, ref, disponible: true, operacion: "Venta", tipo: "Apartamento", zona, ciudad, precio, habitaciones: 3, banos: 2, garaje: 1, area: "60", ...extra };
}
const ROBLEDO = prop("10013440", "Robledo", "Medellín", "$250.000.000");
const LOMA_DEL_INDIO = prop("9965804", "Loma del Indio", "Medellín", "$640.000.000");
const ENVIGADO = prop("10203968", "La Cuenca", "Envigado", "$520.000.000");
const BOSTON_CARO = prop("1", "Boston", "Medellín", "$400.000.000");

test("filtrar: deja lo del pedido y saca otra zona y lo que pasa el tope", () => {
  const { quedan, fuera } = busquedaColega.filtrar([LOMA_DEL_INDIO, ROBLEDO, ENVIGADO, BOSTON_CARO], PEDIDO_H87A);
  assert.deepStrictEqual(quedan.map((p) => p.ref), ["10013440"]);
  assert.strictEqual(quedan[0].calce_pedido, "exacta");
  assert.strictEqual(fuera, 3);
});

function ctxColega() {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573000009183", categoria: "otros" },
    colega: { nombre: "Juan Felipe" },
    pedidoColegaId: "sig-h87a",
    propertyInteres: null, captadorAlert: null,
  };
}

test("buscar_propiedades con un colega se queda dentro de su pedido", async (t) => {
  t.mock.method(properties, "search", async () => [LOMA_DEL_INDIO, ROBLEDO, ENVIGADO]);
  t.mock.method(busquedaColega, "cargarPedido", async () => PEDIDO_H87A);
  const out = await executeTool("buscar_propiedades", { tipo: "Apartamento", operacion: "venta" }, ctxColega());
  assert.match(out, /10013440/);
  assert.doesNotMatch(out, /9965804/);
  assert.doesNotMatch(out, /10203968/);
});

test("sin nada dentro del pedido, Sofi no ofrece lo de afuera y pregunta si amplia", async (t) => {
  t.mock.method(properties, "search", async () => [LOMA_DEL_INDIO, ENVIGADO]);
  t.mock.method(busquedaColega, "cargarPedido", async () => PEDIDO_H87A);
  const out = await executeTool("buscar_propiedades", { tipo: "Apartamento" }, ctxColega());
  assert.doesNotMatch(out, /9965804|10203968/);
  assert.match(out, /NO se le ofrecen/);
  assert.match(out, /fuera_del_pedido: true/);
});

test("una ref puntual o fuera_del_pedido no se filtran", async (t) => {
  t.mock.method(properties, "findByRef", async () => LOMA_DEL_INDIO);
  t.mock.method(properties, "search", async () => [ENVIGADO]);
  const cargar = t.mock.method(busquedaColega, "cargarPedido", async () => PEDIDO_H87A);
  assert.match(await executeTool("buscar_propiedades", { ref: "9965804" }, ctxColega()), /9965804/);
  assert.match(await executeTool("buscar_propiedades", { zona: "Envigado", fuera_del_pedido: true }, ctxColega()), /10203968/);
  assert.strictEqual(cargar.mock.callCount(), 0);
});

test("con un cliente (no colega) la busqueda no cambia", async (t) => {
  t.mock.method(properties, "search", async () => [LOMA_DEL_INDIO]);
  const cargar = t.mock.method(busquedaColega, "cargarPedido", async () => PEDIDO_H87A);
  const ctx = { ...ctxColega(), colega: null, pedidoColegaId: null };
  assert.match(await executeTool("buscar_propiedades", { zona: "Laureles" }, ctx), /9965804/);
  assert.strictEqual(cargar.mock.callCount(), 0);
});

test("aliado: el mismo lote contado otra vez es la misma propiedad", () => {
  const a = { origen: "asesor", ref: null, contacto_telefono: "57300", tipo: "Lote", zona: "San Vicente Ferrer", precio: "$245.000.000 negociables" };
  assert.ok(allyProperties.mismaPropiedadDelColega(a, { ...a, precio: "$245 millones negociables", descripcion: "otra" }));
  assert.ok(allyProperties.mismaPropiedadDelColega(a, { ...a, tipo: null }));
  assert.ok(!allyProperties.mismaPropiedadDelColega(a, { ...a, precio: "$300.000.000" }));
  assert.ok(!allyProperties.mismaPropiedadDelColega(a, { ...a, contacto_telefono: "57999" }));
  assert.ok(!allyProperties.mismaPropiedadDelColega({ ...a, origen: "grupo" }, a));
});

test("aliado ya registrado: Sofi no se disculpa ni lo vuelve a registrar", async (t) => {
  t.mock.method(allyProperties, "create", async (orgId, fields) => ({ id: "ally-1", ...fields, actualizada: true }));
  const out = await executeTool(
    "registrar_propiedad_aliado",
    { contacto_nombre: "Simón", tipo: "Lote", zona: "San Vicente Ferrer", precio: "$245.000.000" },
    { ...ctxColega(), lastUserMessage: "[Imagen recibida]" }
  );
  assert.match(out, /YA estaba registrada/);
  assert.match(out, /no te disculpes/);
});
