// test/group-cruce-mandatos.test.js
//
// El piso del filtro. Decision de producto de Juan (2026-08-25): filo bajo,
// salvedades escritas — Natalia decide que sirve, el sistema no descarta por
// ella. Pero un aviso que aprende a ignorar es peor que no mandarlo, y de eso
// se ocupan los tres cortes duros de aca: operacion, zona y precio.
const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarOferta, criterioDeMandato } = require("../src/groups/cruce-mandatos");

const MANDATO = {
  id: "m-2",
  cliente_nombre: "Marcela Restrepo",
  operacion: "venta",
  tipo: "apartamento",
  zonas: ["El Poblado"],
  zonas_excluidas: [],
  precio_max: 2200000000,
  habitaciones: 4,
  flexible_habitaciones: false,
  area_min: 150,
  exigencias: ["balcón", "vista", "moderna"],
};

// Shape de una oferta ya normalizada a ally_properties (ver ofertas.js).
const OFERTA = {
  tipo: "Apartamento",
  operacion: "Venta",
  zona: "El Poblado",
  precio: "$1.580.000.000",
  habitaciones: 4,
  area: 246,
};

test("una oferta de arriendo NO sirve para un mandato de compra", () => {
  const r = evaluarOferta({ ...OFERTA, operacion: "Arriendo" }, MANDATO);
  assert.strictEqual(r, null, "cruzar operaciones distintas es el error mas caro: rompe la confianza en el aviso");
});

test("una oferta fuera de la zona pedida y sin vecindad NO sirve", () => {
  const r = evaluarOferta({ ...OFERTA, zona: "Bello" }, MANDATO);
  assert.strictEqual(r, null);
});

test("una oferta 14% arriba del tope SI sirve, con la salvedad escrita", () => {
  const r = evaluarOferta({ ...OFERTA, precio: "$2.508.000.000" }, MANDATO);
  assert.ok(r, "14% esta dentro del margen del 15%");
  assert.ok(r.salvedades.some((s) => /precio|tope/i.test(s)), `las salvedades deben nombrar el precio: ${JSON.stringify(r.salvedades)}`);
});

test("una oferta 20% arriba del tope NO sirve", () => {
  const r = evaluarOferta({ ...OFERTA, precio: "$2.640.000.000" }, MANDATO);
  assert.strictEqual(r, null);
});

test("cumple todo: sin salvedades de habitaciones ni area", () => {
  const r = evaluarOferta(OFERTA, MANDATO);
  assert.ok(r.sirve);
  assert.ok(r.cumple.length > 0, "debe decir que cumple");
  assert.ok(!r.salvedades.some((s) => /habitacion|alcoba/i.test(s)));
  assert.ok(!r.salvedades.some((s) => /m²|area/i.test(s)));
});

test("le falta area: sirve, y la salvedad dice cuanto le falta", () => {
  const r = evaluarOferta({ ...OFERTA, area: 145 }, MANDATO);
  assert.ok(r.sirve, "quedarse corto en area no descalifica — lo decide el asesor");
  assert.ok(
    r.salvedades.some((s) => s.includes("145") && s.includes("150")),
    `la salvedad debe ser accionable, no un puntaje: ${JSON.stringify(r.salvedades)}`
  );
});

test("le falta una habitacion: sirve, con la salvedad", () => {
  const r = evaluarOferta({ ...OFERTA, habitaciones: 3 }, MANDATO);
  assert.ok(r.sirve);
  assert.ok(r.salvedades.some((s) => /3 de las 4/.test(s)), JSON.stringify(r.salvedades));
});

test("las exigencias de texto libre SIEMPRE salen como sin verificar", () => {
  // No se pueden comprobar contra una publicacion de WhatsApp. Callarlas seria
  // dejar que el asesor asuma que estan verificadas.
  const r = evaluarOferta(OFERTA, MANDATO);
  const texto = r.salvedades.join(" ");
  for (const e of MANDATO.exigencias) assert.ok(texto.includes(e), `falta la exigencia "${e}"`);
});

test("un dato que la oferta no trae no inventa que cumple", () => {
  const r = evaluarOferta({ ...OFERTA, area: null }, MANDATO);
  assert.ok(!r.cumple.some((c) => /m²/.test(c)), "sin area, no se puede afirmar que cumple el area");
});

test("criterioDeMandato traduce al shape que espera evaluarCandidata", () => {
  const c = criterioDeMandato(MANDATO);
  assert.deepStrictEqual(c.zonas, ["El Poblado"]);
  assert.strictEqual(c.precio_max, 2200000000);
  assert.strictEqual(c.habitaciones, 4);
  assert.strictEqual(c.area_min, 150);
  assert.strictEqual(c.operacion, "venta");
});

// Defecto 1 (Important): sin precio en la oferta, el corte de precio quedaba
// mudo — ni cumple ni salvedad. Es el dato mas sensible; no puede callarse.
test("una oferta sin precio deja salvedad explicita, no silencio", () => {
  const r = evaluarOferta({ ...OFERTA, precio: null }, MANDATO);
  assert.ok(r, "sin precio no se descarta — es blando como los demas datos ausentes");
  assert.ok(
    r.salvedades.some((s) => /precio/i.test(s) && s.includes("2.200.000.000")),
    `debe decir explicitamente que no hay precio: ${JSON.stringify(r.salvedades)}`
  );
  assert.ok(!r.cumple.some((c) => /presupuesto/i.test(c)));
});

// Defecto 2 (Important): un precio muy por debajo del tope casi siempre es un
// error de captura en El Poblado, no un hallazgo. No se descarta (filo bajo),
// pero tampoco se afirma que "cumple" — se le pide al asesor que confirme.
test("un precio muy por debajo del tope pide confirmar, no afirma que cumple", () => {
  const r = evaluarOferta({ ...OFERTA, precio: "$150.000.000" }, MANDATO);
  assert.ok(r, "filo bajo: no se descarta aunque el precio parezca un error de captura");
  assert.ok(!r.cumple.some((c) => /presupuesto/i.test(c)), "no se afirma que cumple presupuesto sin verificar el numero");
  assert.ok(
    r.salvedades.some((s) => s.includes("150.000.000") && s.includes("2.200.000.000")),
    `la salvedad debe nombrar los dos numeros para que el asesor confirme: ${JSON.stringify(r.salvedades)}`
  );
});

// Defecto 3 (Important): el puntaje del motor de venta ya no discrimina nada
// en este carril (criterio angosto) y no puede mostrarse como calidad de match.
test("el JSDoc de evaluarOferta advierte que el puntaje no es calidad de match aca", () => {
  const path = require("path");
  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "src", "groups", "cruce-mandatos.js"),
    "utf8"
  );
  const jsdocMatch = src.match(/\/\*\*[\s\S]*?evaluarOferta/);
  assert.ok(jsdocMatch, "debe existir un JSDoc justo antes de evaluarOferta");
  // Normalizado en una sola linea: el comentario real viene partido en varias
  // lineas con " * " al inicio de cada una, y eso rompe cualquier regex que
  // busque una frase literal atravesando saltos de linea.
  const jsdoc = jsdocMatch[0];
  const plano = jsdoc.replace(/^\s*\*\/?/gm, " ").replace(/\s+/g, " ");
  assert.ok(/puntaje/i.test(plano), "el JSDoc debe mencionar puntaje");
  assert.ok(
    /no mide calidad de match|no representa calidad de match|no es (una )?medida de calidad/i.test(plano),
    `el JSDoc debe advertir explicitamente que puntaje no mide calidad de match: ${plano}`
  );
  assert.ok(
    /% de match|porcentaje de match/i.test(plano),
    "el JSDoc debe advertir contra mostrarlo como % de match en un panel"
  );
});

test("puntaje sigue viajando como dato diagnostico, no se elimina", () => {
  const r = evaluarOferta(OFERTA, MANDATO);
  assert.strictEqual(typeof r.puntaje, "number");
});

// Defecto 4 (Minor): flexible_habitaciones se calculaba y nunca se leia. Un
// mandato flexible que se queda corto en habitaciones tiene que decirlo.
test("le falta una habitacion y el mandato es flexible: la salvedad lo dice", () => {
  const mandatoFlexible = { ...MANDATO, flexible_habitaciones: true };
  const r = evaluarOferta({ ...OFERTA, habitaciones: 3 }, mandatoFlexible);
  assert.ok(r.sirve);
  assert.ok(
    r.salvedades.some((s) => /estudio|servicio/i.test(s)),
    `con flexible_habitaciones, la salvedad debe decir que acepta una menos con estudio o servicio: ${JSON.stringify(r.salvedades)}`
  );
});

// Defecto 5 (Minor): estrato se prometia en el comentario de cabecera y no
// existia en `blandos` — nunca generaba cumple ni salvedad.
test("estrato pedido y ausente en la oferta: sale como salvedad, no como cumplido", () => {
  const mandatoConEstrato = { ...MANDATO, estrato: 5 };
  const r = evaluarOferta(OFERTA, mandatoConEstrato);
  assert.ok(r.sirve);
  assert.ok(
    r.salvedades.some((s) => /estrato/i.test(s) && s.includes("5")),
    `sin estrato en la oferta, debe salir como dato ausente: ${JSON.stringify(r.salvedades)}`
  );
  assert.ok(!r.cumple.some((c) => /estrato/i.test(c)));
});

test("estrato pedido y cumplido en la oferta: sale en cumple", () => {
  const mandatoConEstrato = { ...MANDATO, estrato: 5 };
  const r = evaluarOferta({ ...OFERTA, estrato: 5 }, mandatoConEstrato);
  assert.ok(r.cumple.some((c) => /estrato/i.test(c) && c.includes("5")));
});

// Defecto 5 (Minor): precio_min del mandato (piso explicito del cliente) se
// calculaba en criterioDeMandato y nunca se leia en evaluarOferta.
// Bug CRITICAL (Juan, 2026-08-25): evaluarCandidata deja pasar "otra_zona"
// (misma ciudad, otro barrio) con un castigo de puntaje que en este carril no
// tiene ningun efecto (no hay umbral). Un mandato con `ciudad` puesta (el
// schema de la tool invita a llenarla) recibia avisos de cualquier barrio de
// la misma ciudad.
test("misma ciudad pero otro barrio (ni exacto ni vecino) NO sirve", () => {
  const mandato = { ...MANDATO, ciudad: "Medellín" };
  const r = evaluarOferta({ ...OFERTA, zona: "Robledo", ciudad: "Medellín" }, mandato);
  assert.strictEqual(r, null, "otra_zona dentro de la misma ciudad no es un corte que este carril pueda saltarse");
});

test("la oferta esta por debajo del piso explicito (precio_min) del mandato", () => {
  // precio_min alto a proposito para que quede POR ENCIMA de la banda del 60%
  // (asi la salvedad que se dispara es la del piso explicito, no la generica
  // de "muy por debajo del tope" del defecto 2).
  const mandatoConPiso = { ...MANDATO, precio_min: 1650000000 };
  const r = evaluarOferta({ ...OFERTA, precio: "$1.580.000.000" }, mandatoConPiso);
  assert.ok(r.sirve);
  assert.ok(
    r.salvedades.some((s) => /piso/i.test(s) && s.includes("1.650.000.000")),
    `debe avisar que la oferta esta por debajo del piso pedido por el cliente: ${JSON.stringify(r.salvedades)}`
  );
});
