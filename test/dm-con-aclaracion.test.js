// DM con aclaracion (Juan, 2026-10-20): lo DESCONOCIDO de barrio, piso,
// parqueadero y precio sale con una aclaracion en la ficha; la zona vecina
// nunca sale; lo que se sabe y no cumple tampoco. Ver
// publicable.js#MOTIVOS_ACLARABLES.

const { test } = require("node:test");
const assert = require("node:assert");
const publicable = require("../src/groups/publicable");
const redactar = require("../src/groups/redactar");
const { evaluarCandidata } = require("../src/groups/match");

function ficha(extra = {}) {
  return {
    fuente: "diamond", ref: "AP1", titulo: "Apartamento en Venta Envigado",
    zona: "Envigado", precio: "$450.000.000", operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/ap1",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10416693",
    habitaciones: 3, area: "90m2", puntaje: 85, ubicacion: "exacta", ...extra,
  };
}

const ON = { umbral: 0, conAclaracion: true };

test("el interruptor esta apagado por defecto y solo 'true' lo enciende", () => {
  assert.strictEqual(publicable.dmConAclaracionActivo({}), false);
  assert.strictEqual(publicable.dmConAclaracionActivo({ RADAR_DM_CON_ACLARACION: "false" }), false);
  assert.strictEqual(publicable.dmConAclaracionActivo({ RADAR_DM_CON_ACLARACION: "1" }), false);
  assert.strictEqual(publicable.dmConAclaracionActivo({ RADAR_DM_CON_ACLARACION: "true" }), true);
  assert.strictEqual(publicable.dmConAclaracionActivo({ RADAR_DM_CON_ACLARACION: " TRUE " }), true);
});

test("solo los cuatro datos desconocidos pasan a aclaracion", () => {
  assert.deepStrictEqual(
    [...publicable.MOTIVOS_ACLARABLES].sort(),
    ["garajes_sin_dato", "piso_sin_confirmar", "precio_sin_confirmar", "sector_sin_confirmar"]
  );
});

test("apagado: filtrar da exactamente lo de siempre", () => {
  const ms = [ficha({ ref: "A" }), ficha({ ref: "B", piso_sin_confirmar: true })];
  const r = publicable.filtrar(ms, { umbral: 0 });
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["A"]);
  assert.deepStrictEqual(r.descartados, [{ ref: "B", motivos: ["piso_sin_confirmar"] }]);
  assert.deepStrictEqual(r.aclaraciones, []);
});

test("encendido: una ficha con solo el piso sin confirmar sale, con su aclaracion", () => {
  const r = publicable.filtrar([ficha({ piso_sin_confirmar: true })], ON);
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["AP1"]);
  assert.deepStrictEqual(r.descartados, []);
  assert.strictEqual(r.aclaraciones.length, 1);
  assert.strictEqual(r.aclaraciones[0].ref, "AP1");
  assert.match(r.aclaraciones[0].detalle, /no tengo registrado en qué piso está/);
});

test("encendido: varios datos desconocidos salen todos en la aclaracion", () => {
  const r = publicable.filtrar([ficha({ piso_sin_confirmar: true, garajes_sin_dato: true, precio_sin_confirmar: true, precio_texto_en_margen: true })], ON);
  assert.strictEqual(r.publicables.length, 1);
  const d = r.aclaraciones[0].detalle;
  assert.match(d, /piso/);
  assert.match(d, /parqueadero/);
  assert.match(d, /precio final/);
});

test("zona vecina + piso sin confirmar: no sale", () => {
  const r = publicable.filtrar([ficha({ ubicacion: "vecina", piso_sin_confirmar: true })], ON);
  assert.deepStrictEqual(r.publicables, []);
  assert.deepStrictEqual(r.aclaraciones, []);
  assert.deepStrictEqual(r.descartados[0].motivos.sort(), ["piso_sin_confirmar", "zona_vecina"]);
});

test("cualquier otro motivo sigue bloqueando aunque venga con uno aclarable", () => {
  for (const extra of [
    { amoblado_sin_confirmar: true },
    { edificio_sin_confirmar: true },
    { varios_pedidos: true },
    { fuente: "aliado" },
    { precio: "$0" },
    { linkWasi: "" },
  ]) {
    const r = publicable.filtrar([ficha({ piso_sin_confirmar: true, ...extra })], ON);
    assert.deepStrictEqual(r.publicables, [], `no deberia salir con ${JSON.stringify(extra)}`);
  }
  const viejo = publicable.filtrar([ficha({ piso_sin_confirmar: true })], { ...ON, syncFresco: false });
  assert.deepStrictEqual(viejo.publicables, [], "con el sync viejo no sale nada");
});

test("el puntaje bajo sigue frenando cuando hay umbral (camino del grupo)", () => {
  const r = publicable.filtrar([ficha({ piso_sin_confirmar: true, puntaje: 50 })], { conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
});

test("piso conocido fuera de rango: el motor la descarta, no llega a aclaracion", () => {
  const pedido = {
    operacion: "venta", tipo: "apartamento", zona: "Envigado", zonas: ["Envigado"], zonas_excluidas: [],
    ciudad: "", precio_max: 500000000, precio_min: 0, habitaciones: 2, area_min: 0, banos: 0, garajes: 0,
    estrato: 0, amoblado: "", periodo: "", piso_max: 2, piso_min: 0,
  };
  const prop = {
    ref: "10031500", titulo: "Apartamento en Venta Envigado", tipo: "Apartamento", operacion: "Venta",
    precio: "$490.000.000", area: "80m2", habitaciones: 3, zona: "Envigado", ciudad: "Envigado",
    descripcion: "", caracteristicas: "piso 9, balcon",
  };
  assert.strictEqual(evaluarCandidata(prop, pedido, "diamond"), null);
});

test("orden: primero las que encajan del todo, despues las con aclaracion, cada grupo por puntaje", () => {
  const ms = [
    ficha({ ref: "ACL-99", puntaje: 99, piso_sin_confirmar: true }),
    ficha({ ref: "EXA-80", puntaje: 80 }),
    ficha({ ref: "ACL-90", puntaje: 90, garajes_sin_dato: true }),
    ficha({ ref: "EXA-95", puntaje: 95 }),
  ];
  const r = publicable.filtrar(ms, ON);
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["EXA-95", "EXA-80", "ACL-99", "ACL-90"]);
  assert.deepStrictEqual(r.aclaraciones.map((a) => a.ref), ["ACL-99", "ACL-90"]);
});

test("el tope del DM (3) deja afuera primero a las de aclaracion", () => {
  const ms = [
    ficha({ ref: "ACL", puntaje: 99, piso_sin_confirmar: true }),
    ficha({ ref: "E1", puntaje: 80 }),
    ficha({ ref: "E2", puntaje: 81 }),
    ficha({ ref: "E3", puntaje: 82 }),
  ];
  const { publicables } = publicable.filtrar(ms, ON);
  const armado = redactar.mensajesAlColega({ autor_nombre: "Ana" }, publicables, {});
  assert.deepStrictEqual(armado.refs, ["E3", "E2", "E1"]);
  assert.strictEqual(redactar.MAX_POR_DM, 3);
});

test("notasParaDm: sin aclaraciones devuelve las notas de Sofi tal cual", () => {
  const notas = { sinConfirmar: ["piso"], leFalta: [{ ref: "AP1", detalle: "x" }] };
  const r = publicable.notasParaDm(notas, []);
  assert.strictEqual(r.sinConfirmar, notas.sinConfirmar);
  assert.strictEqual(r.leFalta, notas.leFalta);
});

test("notasParaDm: la salvedad del primer mensaje no repite lo que ya va en la ficha", () => {
  const aclaraciones = [{ ref: "AP1", motivos: ["piso_sin_confirmar"], detalle: "..." }];
  const r = publicable.notasParaDm({ sinConfirmar: ["piso", "terraza"], leFalta: [] }, aclaraciones, [ficha()]);
  assert.deepStrictEqual(r.sinConfirmar, ["terraza"]);
  assert.deepStrictEqual(r.leFalta, [{ ref: "AP1", detalle: publicable.ACLARACIONES_COLEGA.piso_sin_confirmar }]);
});

test("notasParaDm: la aclaracion va antes de la nota de Sofi, y si Sofi ya hablo del tema queda la de ella", () => {
  const aclaraciones = [{ ref: "AP1", motivos: ["piso_sin_confirmar", "precio_sin_confirmar"] }];
  const r = publicable.notasParaDm(
    { leFalta: [{ ref: "AP1", detalle: "cuesta $990M y pediste hasta $900M" }, { ref: "OTRA", detalle: "y" }] },
    aclaraciones
  );
  const detalle = r.leFalta.find((f) => f.ref === "AP1").detalle;
  assert.strictEqual(detalle, "no tengo registrado en qué piso está: te lo confirmo si te sirve · te confirmo el precio final · cuesta $990M y pediste hasta $900M");
  assert.ok(r.leFalta.some((f) => f.ref === "OTRA"), "las notas de otras refs no se tocan");

  const deSofi = publicable.notasParaDm({ leFalta: [{ ref: "AP1", detalle: "no tiene el piso registrado" }] }, [
    { ref: "AP1", motivos: ["piso_sin_confirmar"] },
  ]);
  assert.deepStrictEqual(deSofi.leFalta, [{ ref: "AP1", detalle: "no tiene el piso registrado" }]);
});

test("notasParaDm: una aclaracion de una ref que no sale no toca la salvedad", () => {
  const r = publicable.notasParaDm(
    { sinConfirmar: ["piso"], leFalta: [] },
    [{ ref: "NO-SALE", motivos: ["piso_sin_confirmar"] }],
    [ficha({ ref: "AP1" })]
  );
  assert.deepStrictEqual(r.sinConfirmar, ["piso"]);
});

test("ficha con solo el sector sin confirmar: el DM dice el municipio y que falta el barrio, una sola vez", () => {
  const m = ficha({ ubicacion: "zona_general", zona: "Envigado" });
  const { publicables, aclaraciones } = publicable.filtrar([m], ON);
  assert.strictEqual(publicables.length, 1);
  const notas = publicable.notasParaDm({ sinConfirmar: ["barrio exacto"], leFalta: [] }, aclaraciones, publicables);
  const armado = redactar.mensajesAlColega({ autor_nombre: "Ana" }, publicables, {
    ...notas,
    pedido: { zonas: ["Barrio Mesa"], zona: "Barrio Mesa" },
  });
  const textoFicha = armado.mensajes[1].texto;
  assert.match(textoFicha, /Aclaración: queda en Envigado; el barrio exacto no lo tengo registrado/);
  assert.strictEqual((textoFicha.match(/barrio exacto/g) || []).length, 1);
  assert.doesNotMatch(armado.mensajes[0].texto, /barrio/, "la presentacion no lo repite");
});

test("el texto nuevo va en tuteo, sin voseo", () => {
  for (const m of publicable.MOTIVOS_ACLARABLES) {
    const t = publicable.ACLARACIONES_COLEGA[m];
    if (t) assert.doesNotMatch(t, /necesitás|confirmame|confírmame|decime|querés|podés/, `${m}: ${t}`);
  }
});

// ── Precio por confirmar: solo si los DOS precios caben en el presupuesto ──
const pedidoPrecio = (extra = {}) => ({
  operacion: "venta", tipo: "apartamento", zona: "Envigado",
  precio_min: 0, precio_max: 450000000, habitaciones: 3,
  area_min: 0, banos: 0, garajes: 0, estrato: 0, ...extra,
});
const aptoPrecio = (descripcion) => ({
  ref: "P1", titulo: "Apartamento en Envigado", tipo: "Apartamento",
  operacion: "Venta", precio: "$450.000.000", zona: "Envigado", ciudad: "Envigado",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 5, area: "95 m²", descripcion,
  link: "https://diamondinmobiliaria.com/propiedades/p1",
  linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10416693",
});

test("precio: Wasi $450M y descripcion $650M contra tope $450M: bloqueada", () => {
  const m = evaluarCandidata(aptoPrecio("Precio de venta: $650.000.000"), pedidoPrecio(), "diamond");
  assert.strictEqual(m.precio_sin_confirmar, true);
  assert.strictEqual(m.precio_texto_en_margen, false);
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
  assert.ok(r.descartados[0].motivos.includes("precio_sin_confirmar"));
});

test("precio: Wasi $450M y descripcion $480M contra tope $450M: sale con 'te confirmo el precio final'", () => {
  const m = evaluarCandidata(aptoPrecio("Precio de venta: $480.000.000"), pedidoPrecio(), "diamond");
  assert.strictEqual(m.precio_texto_en_margen, true);
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.strictEqual(r.publicables.length, 1);
  assert.match(r.aclaraciones[0].detalle, /te confirmo el precio final/);
});

test("precio: sin presupuesto en el pedido: bloqueada", () => {
  const m = evaluarCandidata(aptoPrecio("Precio de venta: $480.000.000"), pedidoPrecio({ precio_max: 0 }), "diamond");
  assert.strictEqual(m.precio_sin_confirmar, true);
  assert.strictEqual(m.precio_texto_en_margen, false);
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
});

// ── Revision final del rescate (2026-10-20) ────────────────────────────────

function pedidoBarrio(zonas, extra = {}) {
  return {
    operacion: "venta", tipo: "apartamento", zona: zonas[0], zonas, zonas_excluidas: [],
    ciudad: "", precio_max: 1000000000, precio_min: 0, habitaciones: 2, area_min: 0, banos: 0, garajes: 0,
    estrato: 0, amoblado: "", periodo: "", piso_max: 0, piso_min: 0, ...extra,
  };
}

function aptoBarrio(extra = {}) {
  return {
    ref: "X1", titulo: "Apartamento en Venta Envigado", tipo: "Apartamento", operacion: "Venta",
    precio: "$490.000.000", area: "70m2", habitaciones: 3, zona: "Envigado", ciudad: "Envigado",
    descripcion: "", caracteristicas: "", link: "https://diamondinmobiliaria.com/p/x1",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10031500", ...extra,
  };
}

test("8149db34: pedido Dorado/La Paz y la ficha dice 'Sector Campestre Via las Antillas': barrio conocido, bloqueada", () => {
  const m = evaluarCandidata(
    aptoBarrio({ ref: "10031500", titulo: "Vendo Apartamento Sector Campestre Via las Antillas Envigado" }),
    pedidoBarrio(["Dorado", "La Paz"], { precio_max: 620000000 }),
    "diamond"
  );
  assert.ok(m, "el motor la sigue trayendo (la asesora la puede ver)");
  assert.strictEqual(m.ubicacion, "zona_general");
  assert.deepStrictEqual(m.barrio_en_ficha, ["antillas"]);
  const r = publicable.filtrar([m], ON);
  assert.deepStrictEqual(r.publicables, []);
  assert.deepStrictEqual(r.aclaraciones, []);
  assert.ok(r.descartados[0].motivos.includes("sector_sin_confirmar"));
});

test("4015a81c: pedido San Lucas/Calle 10/Zúñiga y la ficha dice 'Poblado Palmas': barrio conocido, bloqueada", () => {
  const m = evaluarCandidata(
    aptoBarrio({ ref: "8989725", titulo: "Apartamento Moderno Poblado Palmas", zona: "El Poblado", ciudad: "Medellín", precio: "$940.000.000" }),
    pedidoBarrio(["Calle 10", "San Lucas", "Zúñiga"]),
    "diamond"
  );
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "zona_general");
  assert.deepStrictEqual(m.barrio_en_ficha, ["palmas"]);
  const r = publicable.filtrar([m], ON);
  assert.deepStrictEqual(r.publicables, []);
  assert.ok(r.descartados[0].motivos.includes("sector_sin_confirmar"));
});

test("ficha sin barrio en el titulo: el barrio sigue siendo desconocido y sale con aclaracion", () => {
  const m = evaluarCandidata(aptoBarrio({ titulo: "Apartamento en Venta Envigado", descripcion: "Cocina integral, mesa de comedor y zona de paz." }), pedidoBarrio(["Dorado", "La Paz"], { precio_max: 620000000 }), "diamond");
  assert.strictEqual(m.ubicacion, "zona_general");
  assert.strictEqual(m.barrio_en_ficha, undefined, "palabras comunes sin 'barrio'/'sector' no cuentan");
  const r = publicable.filtrar([m], ON);
  assert.strictEqual(r.publicables.length, 1);
  assert.deepStrictEqual(r.aclaraciones[0].motivos, ["sector_sin_confirmar"]);
});

test("3ee69b01: la salvedad no nombra una ref que no va en el DM", () => {
  const props = [ficha({ ref: "9944723", caracteristicas: "Balcón, Vista panorámica" })];
  const aclaraciones = [{ ref: "9944723", motivos: ["precio_sin_confirmar"], detalle: "te confirmo el precio final" }];
  const notas = publicable.notasParaDm({ sinConfirmar: ["cuarto útil (en 9944723 y 10129664)"], leFalta: [] }, aclaraciones, props);
  assert.deepStrictEqual(notas.sinConfirmar, ["cuarto útil"]);
  assert.ok(!notas.sinConfirmar.join(" ").includes("10129664"));
  // Sin aclaraciones (interruptor apagado) tampoco nombra la que no va.
  const apagado = publicable.notasParaDm({ sinConfirmar: ["cuarto útil (en 9944723 y 10129664)"], leFalta: [] }, [], props);
  assert.deepStrictEqual(apagado.sinConfirmar, ["cuarto útil"]);
  // Si solo nombra refs que no van, la nota se va.
  const fuera = publicable.notasParaDm({ sinConfirmar: ["terraza (en 10129664)"], leFalta: [] }, [], props);
  assert.deepStrictEqual(fuera.sinConfirmar, []);
});

test("2e6fea9a: 'administración' sin confirmar solo para la ficha que no la muestra", () => {
  const props = [
    ficha({ ref: "10013189", administracion: "No aplica", caracteristicas: "balcon, piso 5" }),
    ficha({ ref: "9944723" }),
    ficha({ ref: "10113016", administracion: "$180.000" }),
  ];
  const aclaraciones = [{ ref: "10113016", motivos: ["piso_sin_confirmar"], detalle: "no tengo registrado en qué piso está" }];
  const notas = publicable.notasParaDm({ sinConfirmar: ["cuarto útil", "piso exacto", "administración"], leFalta: [] }, aclaraciones, props);
  assert.deepStrictEqual(notas.sinConfirmar, ["cuarto útil", "administración (en 9944723)"]);
  // Si todas la muestran, no se menciona.
  const todas = publicable.notasParaDm({ sinConfirmar: ["administración"], leFalta: [] }, [], [props[0], props[2]]);
  assert.deepStrictEqual(todas.sinConfirmar, []);
  // El cuarto útil registrado en la ficha tampoco se da por desconocido.
  const conCuarto = publicable.notasParaDm({ sinConfirmar: ["cuarto útil"], leFalta: [] }, [], [ficha({ ref: "A", caracteristicas: "piso 9, cuarto util" }), ficha({ ref: "B" })]);
  assert.deepStrictEqual(conCuarto.sinConfirmar, ["cuarto útil (en B)"]);
});

test("revisadas: una nota de Sofi sin refs habla solo de las fichas que ella vio", () => {
  const props = [ficha({ ref: "A" }), ficha({ ref: "B" })];
  const n = publicable.notasParaDm({ sinConfirmar: ["para estrenar"], leFalta: [] }, [], props, { revisadas: new Set(["A"]) });
  assert.deepStrictEqual(n.sinConfirmar, ["para estrenar (en A)"]);
  const nadie = publicable.notasParaDm({ sinConfirmar: ["para estrenar"], leFalta: [] }, [], props, { revisadas: new Set() });
  assert.deepStrictEqual(nadie.sinConfirmar, []);
});

test("prompt de Sofi, regla 43: la frase que se le dice al cliente va en tuteo", () => {
  const fuente = require("node:fs").readFileSync(require.resolve("../src/agent/prompts.js"), "utf8");
  assert.match(fuente, /¿la consultas para ti o para un cliente tuyo de otra inmobiliaria\?/);
  assert.doesNotMatch(fuente, /para vos o para/);
});
