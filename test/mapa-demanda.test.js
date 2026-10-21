// Mapa de demanda (src/groups/mapa-demanda.js): reglas del brief
// .superpowers/sdd/demanda-brief.md y textos del mockup aprobado 2026-10-21.
const { test } = require("node:test");
const assert = require("node:assert");
const md = require("../src/groups/mapa-demanda");

const M = 1_000_000;
let n = 0;
const ped = (o) => ({ id: `s${++n}`, clase: "demanda", operacion: "venta", tipo: "apartamento", zonas: ["Envigado"], precio_max: 600 * M, matches: [], texto_original: `pedido ${n}`, group_id: "g1", ...o });
const prop = (o) => ({ ref: `r${++n}`, tipo: "Apartamento", operacion: "Venta", zona: "Envigado", ciudad: "Medellín", precio: "$650.000.000", disponible: true, created_at: "2026-07-01T00:00:00Z", ...o });
const celda = (r, id) => r.celdas.find((c) => c.id === id);
const AHORA = Date.parse("2026-10-21T15:00:00Z");

test("dedup por texto normalizado: el mismo pedido en varios grupos cuenta una vez", () => {
  const r = md.calcular({
    pedidos: [ped({ texto_original: "Busco  APTO Envigado" }), ped({ texto_original: "busco apto   envigado", group_id: "g2" }), ped({})],
    dias: 90,
  });
  assert.equal(r.kpis.pedidos, 2);
  assert.equal(celda(r, "Envigado|apartamento|500-800").pedidos, 2);
});

test("multi-zona: suma 1 en cada macrozona distinta; barrio cuenta en su municipio", () => {
  const r = md.calcular({ pedidos: [ped({ zonas: ["Barrio Mesa", "La Paz", "Los Balsos"] })], dias: 90 });
  assert.equal(celda(r, "Envigado|apartamento|500-800").pedidos, 1);
  assert.equal(celda(r, "El Poblado|apartamento|500-800").pedidos, 1);
  assert.equal(r.kpis.pedidos, 1);
});

test("zona con paréntesis: gana la primera macrozona; sin zona va a Otras", () => {
  assert.deepEqual(md.macrozonasDePedido({ zona: "El Poblado (desde la 10 hasta Benedictinos)" }), ["El Poblado"]);
  assert.deepEqual(md.macrozonasDePedido({ zona: null, zonas: null }), ["Otras"]);
  assert.deepEqual(md.macrozonasDePedido({ zonas: ["Loma de los Bernal"] }), ["Belén"]);
  assert.deepEqual(md.macrozonasDePedido({ zona: "Rionegro, Llanogrande" }), ["Oriente"]);
  assert.equal(md.macrozonaDePropiedad({ zona: "", ciudad: "Sabaneta" }), "Sabaneta");
  assert.equal(md.macrozonaDePropiedad({ zona: "Loma Del Indio", ciudad: "Medellín" }), "El Poblado");
});

test("dúplex, penthouse y loft cuentan como apartamento; tipo múltiple suma en cada uno", () => {
  assert.deepEqual(md.tiposDePedido("Dúplex"), ["apartamento"]);
  assert.deepEqual(md.tiposDePedido("penthouse"), ["apartamento"]);
  assert.deepEqual(md.tiposDePedido("loft"), ["apartamento"]);
  assert.deepEqual(md.tiposDePedido("apartaestudio"), ["apartaestudio"]);
  assert.deepEqual(md.tiposDePedido("casa, apartamento").sort(), ["apartamento", "casa"]);
  assert.equal(md.tipoDePropiedad({ tipo: "Casa Campestre" }), "finca");
  assert.equal(md.tipoDePropiedad({ tipo: "Lote / Terreno" }), "lote");
  assert.equal(md.tipoDePropiedad({ tipo: "Oficina" }), "local-oficina");
  const r = md.calcular({ pedidos: [ped({ tipo: "Penthouse" })], propiedades: [prop({ tipo: "Dúplex" })], dias: 90 });
  assert.equal(celda(r, "Envigado|apartamento|500-800").tenemos, 1);
});

test("bandas de venta y de arriendo", () => {
  assert.equal(md.bandaDe(250 * M, "venta").id, "<300");
  assert.equal(md.bandaDe(300 * M, "venta").id, "300-500");
  assert.equal(md.bandaDe("$800.000.000", "venta").id, "800-1200");
  assert.equal(md.bandaDe(1200 * M, "venta").id, "1200-2000");
  assert.equal(md.bandaDe(2500 * M, "venta").id, ">2000");
  assert.equal(md.bandaDe(null, "venta").id, "sin");
  assert.equal(md.bandaDe(2_500_000, "arriendo").id, "<3");
  assert.equal(md.bandaDe(3_500_000, "arriendo").id, "3-6");
  assert.equal(md.bandaDe(6 * M, "arriendo").id, "6-10");
  assert.equal(md.bandaDe(12 * M, "arriendo").id, ">10");
});

test("compra mal clasificada como arriendo (>= 60 M) cuenta como venta", () => {
  assert.equal(md.operacionDePedido({ operacion: "arriendo", precio_max: 450 * M }), "venta");
  assert.equal(md.operacionDePedido({ operacion: "arriendo", precio_max: 3 * M }), "arriendo");
  assert.equal(md.operacionDePedido({ operacion: null, precio_max: null }), null);
  const pedidos = [ped({ operacion: "arriendo", precio_max: 450 * M }), ped({ operacion: "arriendo", precio_max: 4 * M })];
  assert.equal(md.calcular({ pedidos, dias: 90, operacion: "venta" }).kpis.pedidos, 1);
  const arr = md.calcular({ pedidos, dias: 90, operacion: "arriendo" });
  assert.equal(arr.kpis.pedidos, 1);
  assert.ok(celda(arr, "Envigado|apartamento|3-6"));
});

test("tenemos por celda: misma operación, macrozona, tipo y banda, solo disponibles", () => {
  const r = md.calcular({
    pedidos: [ped({})],
    propiedades: [
      prop({}),
      prop({ precio: "$900.000.000" }), // otra banda
      prop({ zona: "Sabaneta" }), // otra zona
      prop({ operacion: "Arriendo", precio: "$650.000.000" }), // otra operacion
      prop({ disponible: false }),
      prop({ zona: "Zúñiga" }), // barrio de Envigado
    ],
    dias: 90,
  });
  const c = celda(r, "Envigado|apartamento|500-800");
  assert.equal(c.tenemos, 2);
  assert.equal(c.porPropiedad, 0.5);
});

test("celda caliente: >= 30 por propiedad en 90 días, escalado al período", () => {
  assert.equal(md.umbralCaliente(90), 30);
  assert.equal(md.umbralCaliente(30), 10);
  const diez = Array.from({ length: 10 }, () => ped({}));
  const r30 = md.calcular({ pedidos: diez, propiedades: [prop({})], dias: 30 });
  assert.equal(celda(r30, "Envigado|apartamento|500-800").caliente, true);
  assert.equal(celda(r30, "Envigado|apartamento|500-800").pedidosMes, 10);
  const r90 = md.calcular({ pedidos: diez, propiedades: [prop({})], dias: 90 });
  assert.equal(celda(r90, "Envigado|apartamento|500-800").caliente, false);
  assert.equal(celda(r90, "Envigado|apartamento|500-800").pedidosMes, 3);
  assert.equal(r30.kpis.celdasCalientes, 1);
});

test("orden: pedidos por propiedad y luego pedidos", () => {
  const pedidos = [
    ...Array.from({ length: 4 }, () => ped({ zonas: ["Sabaneta"] })),
    ...Array.from({ length: 6 }, () => ped({})),
  ];
  const r = md.calcular({ pedidos, propiedades: [prop({}), prop({}), prop({}), prop({})], dias: 90 });
  assert.deepEqual(r.celdas.map((c) => c.id), ["Sabaneta|apartamento|500-800", "Envigado|apartamento|500-800"]);
});

test("pedidos sin inventario nuestro: sin ref propia con puntaje >= 85", () => {
  const pedidos = [
    ped({ matches: [{ fuente: "diamond", ref: "1", puntaje: 90 }] }),
    ped({ matches: [{ fuente: "diamond", ref: "2", puntaje: 72 }] }),
    ped({ matches: [{ fuente: "aliado", ref: "3", puntaje: 95 }] }),
    ped({ matches: [{ ref: "4" }] }), // sin puntaje: cuenta la ref propia
    ped({}),
  ];
  const r = md.calcular({ pedidos, dias: 90 });
  assert.equal(r.kpis.sinInventario, 3);
  assert.equal(r.kpis.pctSinInventario, 60);
});

test("qué piden: alcobas, parqueadero, portería, piso y barrios", () => {
  const pedidos = [
    ped({ habitaciones: 3, garajes: 2, zonas: ["Envigado", "El Dorado"], texto_original: "apto unidad cerrada" }),
    ped({ habitaciones: 3, zonas: ["La Paz"], texto_original: "3 alcobas con parqueadero, ascensor" }),
    ped({ texto_original: "2 habitaciones porteria 24h", zonas: ["El Dorado"] }),
    ped({ piso_max: 5, zonas: ["Envigado"], texto_original: "algo" }),
  ];
  const c = celda(md.calcular({ pedidos, dias: 90 }), "Envigado|apartamento|500-800");
  const bar = Object.fromEntries(c.quePiden.barras.map((b) => [b.texto, b.pct]));
  assert.equal(bar["3 alcobas"], 50);
  assert.equal(bar["2 alcobas"], 25);
  assert.equal(bar["1 parqueadero o más"], 50);
  assert.equal(bar["2 parqueaderos"], 25);
  assert.equal(bar["Unidad con portería"], 50);
  assert.equal(bar["Piso máximo / ascensor"], 50);
  assert.deepEqual(c.quePiden.barrios, ["El Dorado", "La Paz"]);
});

test("inventario que no calza: disponibles sin match >= 85 en el período, con motivo", () => {
  const r = md.calcular({
    pedidos: [ped({ matches: [{ fuente: "diamond", ref: "A", puntaje: 88 }, { fuente: "diamond", ref: "B", puntaje: 70 }] })],
    propiedades: [prop({ ref: "A" }), prop({ ref: "B" }), prop({ ref: "C", zona: "" }), prop({ ref: "D", tipo: "Finca", zona: "Vereda X" }), prop({ ref: "E", operacion: "Arriendo" })],
    dias: 90,
  });
  assert.equal(r.noCalza.total, 4);
  assert.equal(r.noCalza.n, 3);
  assert.deepEqual(
    r.noCalza.lista.map((x) => [x.ref, x.motivo]),
    [["B", "sin pedidos"], ["C", "sin zona en Wasi"], ["D", "rural"]]
  );
});

test("captaciones del mes en celdas calientes", () => {
  const pedidos = Array.from({ length: 70 }, () => ped({}));
  const r = md.calcular({
    pedidos,
    propiedades: [prop({ ref: "nueva", created_at: "2026-10-05T12:00:00Z" }), prop({ ref: "vieja", created_at: "2026-09-20T12:00:00Z" }), prop({ ref: "fria", zona: "Sabaneta", created_at: "2026-10-06T00:00:00Z" })],
    dias: 90,
    ahora: AHORA,
  });
  assert.deepEqual(r.captaciones, ["nueva"]);
  assert.equal(r.kpis.captacionesCalientes, 1);
});

const banda = md.BANDAS.venta.find((b) => b.id === "500-800");
const base = { orgName: "Diamond Inmobiliaria", pedidosMes: 36, tipo: "apartamento", macrozona: "Envigado", banda, comision: "50/50 con la red" };

test("argumento: texto exacto del mockup con 1 propiedad", () => {
  assert.equal(
    md.argumento({ ...base, tenemos: 1 }),
    "Hola, soy de Diamond Inmobiliaria. Este mes 36 colegas de la red buscaron un apartamento como el suyo en Envigado (de 500 a 800 millones), y hoy solo tenemos uno para ofrecerles. Si nos da la exclusiva, su inmueble le llega a todos ellos el mismo día, con comisión compartida 50/50 con la red. ¿Le parece si lo visitamos esta semana?"
  );
});

test("argumento con 0 y con N, y comisión sin 50/50", () => {
  assert.equal(
    md.argumento({ ...base, tenemos: 0, comision: "" }),
    "Hola, soy de Diamond Inmobiliaria. Este mes 36 colegas de la red buscaron un apartamento como el suyo en Envigado (de 500 a 800 millones), y hoy no tenemos ninguno para ofrecerles. Si nos da la exclusiva, su inmueble le llega a todos ellos el mismo día, compartiendo comisión con la red. ¿Le parece si lo visitamos esta semana?"
  );
  assert.match(md.argumento({ ...base, tenemos: 3 }), /y hoy solo tenemos 3 para ofrecerles/);
  const casa = md.argumento({ ...base, tipo: "casa", tenemos: 1, banda: md.BANDAS.venta.find((b) => b.id === ">2000"), macrozona: "El Poblado" });
  assert.match(casa, /buscaron una casa como el suyo en El Poblado \(de más de 2\.000 millones\), y hoy solo tenemos una para/);
});

test("el argumento de la celda usa pedidos/mes y tenemos", () => {
  const pedidos = Array.from({ length: 109 }, () => ped({}));
  const r = md.calcular({ pedidos, propiedades: [prop({})], dias: 90, orgName: "Diamond Inmobiliaria", comision: "50/50" });
  const c = celda(r, "Envigado|apartamento|500-800");
  assert.equal(c.pedidosMes, 36);
  assert.equal(c.argumento, md.argumento({ ...base, tenemos: 1 }));
});
