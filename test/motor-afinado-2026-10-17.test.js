// Afinado del motor con los hallazgos del 2026-10-17 (Juan: "necesito que
// cada respuesta siempre sea lo mas cerca posible"). Medido sobre los 115 DM
// automaticos del 16-sep al 17-oct.

const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata, areaMaxDe, variosPedidos, precioTextoDe } = require("../src/groups/match");
const publicable = require("../src/groups/publicable");

const pide = (extra = {}) => ({
  operacion: "venta", tipo: "apartamento", zona: "Laureles",
  precio_min: 0, precio_max: 600000000, habitaciones: 3,
  area_min: 0, banos: 0, garajes: 0, estrato: 0, ...extra,
});
const apto = (extra = {}) => ({
  ref: "9944723", titulo: "Apartamento en Laureles", tipo: "Apartamento",
  operacion: "Venta", precio: "$550.000.000", zona: "Laureles", ciudad: "Medellín",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 5, area: "95 m²", descripcion: "",
  link: "https://diamondinmobiliaria.com/propiedades/apto-9944723", ...extra,
});

// ── 1. El piso del pedido se guarda ──────────────────────────────────────
// 0 de 105 pedidos que mencionaban piso lo tenian guardado: group-signals no
// lo escribia. En vivo el motor lo usaba, pero todo lo que se recalcula desde
// la base (DM manual, bandeja, revisiones) lo ignoraba. Caso: a Michell
// Puentes ("Max piso 10") le salio la 10203968, que esta en el piso 15.
test("BUG: el piso que pidio el colega se guarda con la senal", async () => {
  const groupSignals = require("../src/data/group-signals");
  const memory = require("../src/data/memory");
  const antes = memory.groupSignals.length;
  await groupSignals.create("org-piso", {
    group_id: "g1", wa_message_id: `m-${Date.now()}`, clase: "demanda", piso_max: 10, piso_min: 2,
  });
  const fila = memory.groupSignals[memory.groupSignals.length - 1];
  assert.ok(memory.groupSignals.length > antes);
  assert.strictEqual(fila.piso_max, 10);
  assert.strictEqual(fila.piso_min, 2);
});

// ── 2. Tope de area ──────────────────────────────────────────────────────
// "75–85 m²" recibio un apartamento de 153 m²; "65 a 70 m2" uno de 63 m² bien
// pero tambien otros fuera. El rango tiene techo, no solo piso.
test("areaMaxDe lee el techo de un rango de area", () => {
  assert.strictEqual(areaMaxDe({ texto_original: "❄️ Área: 75–85 m²" }), 85);
  assert.strictEqual(areaMaxDe({ texto_original: "100-120m2 3 habitaciones" }), 120);
  assert.strictEqual(areaMaxDe({ texto_original: "UNIDAD 90 - 100 METROS 2 ALCOBAS" }), 100);
  assert.strictEqual(areaMaxDe({ texto_original: "apto de 65 a 70 m2" }), 70);
  assert.strictEqual(areaMaxDe({ texto_original: "⁠100 a 120 m2 - ⁠hasta $4mm" }), 120);
  assert.strictEqual(areaMaxDe({ mensaje: { texto: "entre 80 y 95 mts" } }), 95);
});

test("areaMaxDe no inventa un techo donde no hay rango de metros", () => {
  assert.strictEqual(areaMaxDe({ texto_original: "Área: 120 m² mínimo" }), 0);
  assert.strictEqual(areaMaxDe({ texto_original: "Piso 2 al 11, 3 alcobas" }), 0);
  assert.strictEqual(areaMaxDe({ texto_original: "finca de 3-4 hectáreas" }), 0);
  assert.strictEqual(areaMaxDe({ texto_original: "2 o 3 alcobas" }), 0);
  assert.strictEqual(areaMaxDe({}), 0);
});

test("BUG: una propiedad muy por encima del rango de area se descarta", () => {
  const c = pide({ area_min: 75, texto_original: "Área: 75–85 m²" });
  assert.strictEqual(evaluarCandidata(apto({ area: "153 m²" }), c, "diamond"), null);
});

test("dentro del rango, o pasandose dentro del margen, sigue entrando", () => {
  const c = pide({ area_min: 75, texto_original: "Área: 75–85 m²" });
  assert.ok(evaluarCandidata(apto({ area: "84 m²" }), c, "diamond"));
  assert.ok(evaluarCandidata(apto({ area: "92 m²" }), c, "diamond")); // 85 + 10 %
});

test("sin rango en el pedido, un area grande no descarta (mas grande no es peor)", () => {
  assert.ok(evaluarCandidata(apto({ area: "153 m²" }), pide({ area_min: 75, texto_original: "mínimo 75 m2" }), "diamond"));
});

// ── 3. Varios pedidos en un mensaje ──────────────────────────────────────
// Hexagono mando 3 pedidos numerados y el motor los mezclo en uno: zonas de
// uno, area de otro, precio del tercero. Le salio la 10311728, que no le
// servia a ninguno.
test("variosPedidos reconoce un mensaje con pedidos numerados", () => {
  assert.strictEqual(variosPedidos("*PEDIDOS* 1️⃣Apartamento ... 2️⃣Apartamento ... 3️⃣Apartamento"), true);
  assert.strictEqual(variosPedidos("PEDIDO 1: casa en Envigado. PEDIDO 2: apto en Sabaneta"), true);
  assert.strictEqual(variosPedidos("Busco apartamento 1️⃣ en Laureles, 3 alcobas"), false);
  assert.strictEqual(variosPedidos("Busco apto 2 alcobas 2 baños"), false);
  assert.strictEqual(variosPedidos(""), false);
});

test("una candidata de un mensaje con varios pedidos no sale sola", () => {
  const c = pide({ texto_original: "1️⃣Apartamento Laureles 3 hab\n2️⃣Apartamento Poblado 2 hab" });
  const m = evaluarCandidata(apto(), c, "diamond");
  assert.strictEqual(m.varios_pedidos, true);
  const { publicables, descartados } = publicable.filtrar([m], c);
  assert.strictEqual(publicables.length, 0);
  assert.ok(JSON.stringify(descartados).includes("varios_pedidos"));
});

// ── 4. Precio distinto en Wasi y en la descripcion ───────────────────────
// 7 fichas disponibles dicen un precio en el campo y otro en el texto (la
// 9307551: $750M contra $650M). El colega abre el link y ve otro numero.
test("precioTextoDe lee el precio escrito en la descripcion", () => {
  assert.strictEqual(precioTextoDe({ descripcion: "💲 Precio de venta: $480.000.000 📲" }), 480000000);
  assert.strictEqual(precioTextoDe({ descripcion: "Precio de oportunidad: $2.200.000.000 , por debajo" }), 2200000000);
  assert.strictEqual(precioTextoDe({ descripcion: "Administración: $420.000 COP" }), null);
  assert.strictEqual(precioTextoDe({ descripcion: "sin precio en el texto" }), null);
});

test("si el precio del texto no cuadra con el de Wasi, la ficha no sale sola", () => {
  const p = apto({ precio: "$450.000.000", descripcion: "Precio de venta: $480.000.000" });
  const m = evaluarCandidata(p, pide(), "diamond");
  assert.strictEqual(m.precio_sin_confirmar, true);
  const { publicables } = publicable.filtrar([m], pide());
  assert.strictEqual(publicables.length, 0);
});

test("un precio del texto igual al de Wasi no frena nada", () => {
  const p = apto({ precio: "$550.000.000", descripcion: "Precio: $550.000.000" });
  const m = evaluarCandidata(p, pide(), "diamond");
  assert.strictEqual(m.precio_sin_confirmar, false);
});

test("un numero absurdo en el texto (administracion, typo) no cuenta como precio", () => {
  const typo = evaluarCandidata(apto({ precio: "$550.000.000", descripcion: "Precio $550.000.000.000" }), pide(), "diamond");
  assert.strictEqual(typo.precio_sin_confirmar, false);
  const adm = evaluarCandidata(apto({ precio: "$470.000.000", descripcion: "precio administración $200.000" }), pide(), "diamond");
  assert.strictEqual(adm.precio_sin_confirmar, false);
});
